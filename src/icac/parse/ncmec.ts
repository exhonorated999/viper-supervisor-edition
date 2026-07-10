// NCMEC CyberTipline Report extractor.
//
// Calibrated against real reports (128656101, 211809625, 218215259, 220571687,
// 220632092, 220638714, CT138034350). All fields are label-anchored and
// consistent across reports. Party info comes in repeating "Suspect"/"Recipient"
// blocks; IP timestamps sit on the line AFTER the "IP Address:" line.
// ---------------------------------------------------------------------------

import type { CyberTip, Identifiers, IpObservation, PartyBlock, Provider } from "../types";
import { emptyContraband, emptyIdentifiers } from "../types";
import {
  RE, collect, dedupe, extractDeviceIds,
  normEmail, normPhone, providerFromEspName,
} from "./util";

const ROLE_HEADERS = /^(Suspect|Recipient)\b/i;
// Lines that end a party block (next section headers).
const SECTION_END = /^(Additional Information|Uploaded File Information|Section [A-D]:|Contents|Explanation of|Further Information|Geo-Lookup|Auto Refer|Deconfliction|Law Enforcement)/i;

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.trim();
}

/** Parse the repeating Suspect / Recipient blocks. */
function parseParties(lines: string[]): PartyBlock[] {
  const parties: PartyBlock[] = [];
  let cur: PartyBlock | null = null;

  const push = () => { if (cur) parties.push(cur); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const roleM = line.match(ROLE_HEADERS);
    if (roleM && line.replace(ROLE_HEADERS, "").trim().length === 0) {
      push();
      cur = {
        role: /suspect/i.test(roleM[1]) ? "suspect" : "recipient",
        emails: [], usernames: [], phones: [], esp_user_ids: [],
        profile_urls: [], ips: [],
      };
      continue;
    }
    if (!cur) continue;
    if (SECTION_END.test(line)) { push(); cur = null; continue; }

    const kv = (label: RegExp) => line.match(label)?.[1]?.trim();

    let v: string | undefined;
    if ((v = kv(/^Name:\s*(.+)$/i))) cur.name = v;
    else if ((v = kv(/^Mobile Phone:\s*(.+)$/i)) || (v = kv(/^Phone(?: Number)?:\s*(.+)$/i)))
      cur.phones.push(normPhone(v.replace(/\(.*?\)/g, "")));
    else if ((v = kv(/^Email Address:\s*(.+)$/i)))
      cur.emails.push(normEmail(v.replace(/\(.*?\)/g, "")));
    else if ((v = kv(/^Screen\/User ?Name:\s*(.+)$/i)) || (v = kv(/^Username:\s*(.+)$/i)))
      cur.usernames.push(v);
    else if ((v = kv(/^ESP User ID:\s*(.+)$/i))) cur.esp_user_ids.push(v);
    else if ((v = kv(/^Profile URL:\s*(.+)$/i))) cur.profile_urls.push(v);
    else if ((v = kv(/^Date of Birth:\s*(.+)$/i))) cur.date_of_birth = v;
    else if ((v = kv(/^Approximate Age:\s*(.+)$/i))) cur.approximate_age = v;
    else if ((v = kv(/^Estimated Location:\s*(.+)$/i))) cur.estimated_location = v;
    else if ((v = kv(/^IP Address:\s*(.+)$/i))) {
      const km = v.match(/\(([^)]+)\)/);
      const ip = v.replace(/\(.*?\)/g, "").trim();
      const next = (lines[i + 1] || "").trim();
      const seenAt = /UTC|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}/.test(next) && !/:/.test(next.split(" ")[0])
        ? next
        : /UTC/.test(next) ? next : undefined;
      const obs: IpObservation = { ip };
      if (km) obs.kind = km[1];
      if (seenAt) obs.seenAt = seenAt;
      cur.ips.push(obs);
    }
  }
  push();
  return parties;
}

/** Extract contraband metadata (counts / filenames / md5 / categories only). */
function parseContraband(text: string, execTotal?: number) {
  const c = emptyContraband();
  const numM = text.match(/Number of uploaded files:\s*(\d+)/i);
  c.file_count = numM ? parseInt(numM[1], 10) : (execTotal ?? 0);

  // Filenames may wrap across lines until the next label (MD5/Did/Were/…).
  const fnRe = /Filename:\s*([\s\S]*?)(?=\n(?:MD5:|SHA1:|Did |Were |Additional Information:|Image Categorization|Uploaded File Information|Section |Filename:)|$)/gi;
  for (const m of text.matchAll(fnRe)) {
    const name = m[1].replace(/\s+/g, "").trim();
    if (name) c.file_names.push(name);
  }
  c.md5 = dedupe(collect(text, RE.md5));
  const catRe = /Image Categorization by ESP:\s*([A-Za-z0-9]+)/gi;
  c.categories = dedupe(Array.from(text.matchAll(catRe)).map((m) => m[1]));
  if (!c.file_count && c.file_names.length) c.file_count = c.file_names.length;
  return c;
}

function aggregateIdentifiers(parties: PartyBlock[], fullText: string): Identifiers {
  const ids = emptyIdentifiers();
  for (const p of parties) {
    ids.emails.push(...p.emails);
    ids.usernames.push(...p.usernames);
    ids.phone_numbers.push(...p.phones);
    ids.esp_user_ids.push(...p.esp_user_ids);
    ids.ip_addresses.push(...p.ips.map((o) => o.ip));
  }
  // NOTE: we intentionally do NOT sweep the whole document for emails/IPs/phones.
  // Section B–D and footers contain NCMEC/law-enforcement/ESP contact identifiers
  // (e.g. @ncmec.org, @lapd.online, ESP records URLs) that are NOT suspect data.
  // Party (Suspect/Recipient) blocks give clean, attributable identifiers.
  ids.emails = dedupe(ids.emails).filter(isSuspectEmail);
  ids.usernames = dedupe(ids.usernames);
  ids.phone_numbers = dedupe(ids.phone_numbers);
  ids.esp_user_ids = dedupe(ids.esp_user_ids);
  ids.ip_addresses = dedupe(ids.ip_addresses);
  ids.device_ids = extractDeviceIds(fullText);
  return ids;
}

/** Reject organizational / boilerplate contact emails, keep suspect data. */
const ORG_EMAIL_DOMAINS = /@(ncmec\.org|.*\.gov|.*\.online|.*lawenforcement.*|.*records.*)$/i;
function isSuspectEmail(e: string): boolean {
  return !ORG_EMAIL_DOMAINS.test(e);
}

function parsePriorReports(text: string): string[] {
  const m = text.match(/Prior CT Reports:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z][A-Za-z ]*:|\nEstimated Location|\nSection |\n[A-Z][a-z]+\n|$)/i);
  if (!m) return [];
  return dedupe(m[1].split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{4,}$/.test(s)));
}

/**
 * Find the real Reporting-ESP section (the one followed by "Submitter:", NOT the
 * table-of-contents entry) and read the literal ESP name off the next line.
 */
function extractEsp(lines: string[]): { name?: string; provider: Provider } {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^Reporting Electronic Service Provider/i.test(lines[i])) {
      const ahead = lines.slice(i + 1, i + 6).join("\n");
      if (/Submitter:|Company Information|Business Address/i.test(ahead)) { start = i; break; }
    }
  }
  if (start < 0) return { provider: "Other" };
  let name: string | undefined;
  for (let j = start + 1; j < Math.min(start + 8, lines.length); j++) {
    if (/^Submitter:/i.test(lines[j])) {
      for (let k = j + 1; k < Math.min(j + 4, lines.length); k++) {
        const cand = lines[k].trim();
        if (cand && !/^(Business Address:|Company Information|Relevant Terms|https?:)/i.test(cand)) {
          name = cand;
          break;
        }
      }
      break;
    }
  }
  return { name, provider: name ? providerFromEspName(name) : "Other" };
}

export function parseNcmec(text: string, sourceFile: string): CyberTip {
  const lines = text.split("\n");

  const cybertip_number =
    firstMatch(text, /CyberTipline Report\s+#?\s*(\d+)/i) ?? "";
  const priority_level = firstMatch(text, /Priority Level:\s*([A-Za-z0-9]+)/i);
  const execTotal = firstMatch(text, /Total Uploaded Files:\s*(\d+)/i);
  const date_received = firstMatch(text, /Received by NCMEC on\s+(.+?UTC)/i);

  // Prefer the Section-A "Incident Information" type over the exec-summary line.
  const incidentTypes = collect(text, /Incident Type:\s*(.+)/gi).filter((s) => s.length > 2);
  const incident_type = incidentTypes.find((s) => !/unconfirmed/i.test(s)) ?? incidentTypes[0];
  const incident_time = firstMatch(text, /Incident Time:\s*(.+?UTC)/i);

  // Provider = literal ESP name from the reporting-ESP section (authoritative).
  const esp = extractEsp(lines);
  const provider = esp.provider;

  const parties = parseParties(lines);
  const identifiers = aggregateIdentifiers(parties, text);
  const contraband = parseContraband(text, execTotal ? parseInt(execTotal, 10) : undefined);
  const prior_reports = parsePriorReports(text);

  const missing_fields: string[] = [];
  if (!cybertip_number) missing_fields.push("cybertip_number");
  if (!date_received) missing_fields.push("date_received");
  if (provider === "Other") missing_fields.push("provider");
  if (!parties.length) missing_fields.push("parties");
  if (!identifiers.ip_addresses.length && !identifiers.emails.length)
    missing_fields.push("identifiers");

  const hasParty = parties.some((p) => p.role === "suspect") || parties.length > 0;
  const strong =
    !!cybertip_number && provider !== "Other" && hasParty &&
    (identifiers.ip_addresses.length + identifiers.emails.length > 0);
  const parse_confidence = strong ? "high" : cybertip_number ? "medium" : "low";

  return {
    id: cryptoId(),
    cybertip_number,
    date_received: date_received ?? "",
    provider,
    priority_level,
    incident_type,
    incident_time,
    identifiers,
    contraband,
    parties,
    prior_reports,
    linked_tips: [],
    assignment: { assigned_to: null, priority: null, note: null, status: "unassigned" },
    source_file: sourceFile,
    source_doc_type: "ncmec",
    parse_confidence,
    missing_fields,
    imported_at: new Date().toISOString(),
    provider_specific: esp.name ? { esp_name: esp.name } : undefined,
  };
}

function cryptoId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return "tip-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
