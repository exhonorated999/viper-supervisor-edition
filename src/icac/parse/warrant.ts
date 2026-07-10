// Warrant / provider-package extractor (secondary).
//
// Calibrated against WB_CYBERTIP_DEMO (AT&T) and WB_DEMO1234_SNAP (Snapchat).
// These are search-warrant packages keyed by AGENCY CASE NUMBER + provider, not
// NCMEC reports — lower priority, best-effort identifier sweep.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";
import { emptyContraband, emptyIdentifiers } from "../types";
import { RE, collect, dedupe, detectProviderByFrequency, extractDeviceIds, normEmail, normPhone } from "./util";

function firstMatch(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1]?.trim();
}

export function parseWarrant(text: string, sourceFile: string): CyberTip {
  const agencyCase = firstMatch(text, /AGENCY CASE NUMBER:\s*([A-Za-z0-9-]+)/i);
  const warrantNo = firstMatch(text, /WARRANT NUMBER:\s*([A-Za-z0-9-]+)/i);
  const provider = detectProviderByFrequency(text);

  const ids = emptyIdentifiers();
  ids.emails = dedupe(collect(text, RE.email).map(normEmail));
  ids.ip_addresses = dedupe([...collect(text, RE.ipv4), ...collect(text, RE.ipv6)]);
  ids.phone_numbers = dedupe(collect(text, RE.phone).map(normPhone));
  ids.device_ids = extractDeviceIds(text);

  const missing_fields: string[] = [];
  if (!agencyCase) missing_fields.push("agency_case_number");
  if (provider === "Other") missing_fields.push("provider");

  // No verified cybertip number in a warrant package; use agency case as the
  // human key so it is still trackable, flagged low confidence for review.
  const cybertip_number = agencyCase ?? "";

  return {
    id: cryptoId(),
    cybertip_number,
    date_received: "",
    provider,
    incident_type: "Search Warrant / Provider Package",
    identifiers: ids,
    contraband: emptyContraband(),
    parties: [],
    prior_reports: [],
    linked_tips: [],
    assignment: { assigned_to: null, priority: null, note: null, status: "unassigned" },
    source_file: sourceFile,
    source_doc_type: "warrant",
    parse_confidence: agencyCase && provider !== "Other" ? "medium" : "low",
    missing_fields,
    imported_at: new Date().toISOString(),
    provider_specific: { agency_case_number: agencyCase, warrant_number: warrantNo },
  };
}

function cryptoId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return "tip-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
