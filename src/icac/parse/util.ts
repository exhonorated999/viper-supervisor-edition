// Shared parsing utilities for the ICAC PDF → CyberTip pipeline.
//
// Input to parsers is LINE-STRUCTURED text (one logical line per \n). Both
// extractors produce this: the browser pdftext.ts groups pdf.js text items by
// Y-position into lines, and the Node harness uses pypdf/pdfjs line text. Keep
// all parsing line-anchored so it survives extractor differences.
// ---------------------------------------------------------------------------

import type { DeviceIds, Provider } from "../types";

/** Collapse odd whitespace but preserve line breaks. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n");
}

export const RE = {
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  ipv6: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g,
  phone: /\+\d[\d\-\s().]{6,}\d/g,
  md5: /\b[a-f0-9]{32}\b/gi,
  uuid: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  mac: /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g,
  imeiLabeled: /IMEI[:\s#]*([0-9]{15,16})/gi,
  gaidLabeled: /(?:GAID|Advertising ID|Android ID)[:\s]*([0-9a-fA-F-]{16,36})/gi,
  idfaLabeled: /IDFA[:\s]*([0-9a-fA-F-]{16,36})/gi,
} as const;

/** Case-insensitive dedupe preserving first-seen casing. */
export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

export function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

/** Keep leading +, strip all other non-digits. */
export function normPhone(v: string): string {
  const plus = v.trim().startsWith("+") ? "+" : "";
  return plus + v.replace(/[^\d]/g, "");
}

export function collect(text: string, re: RegExp): string[] {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return Array.from(text.matchAll(r)).map((m) => (m[1] ?? m[0]).trim());
}

/** Grab a single labeled field value from a line-structured block. */
export function labelValue(text: string, label: string): string | undefined {
  const re = new RegExp(`^${escapeRe(label)}\\s*:?\\s*(.+)$`, "im");
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v && v.length ? v : undefined;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROVIDER_KEYWORDS: [Provider, RegExp][] = [
  ["WhatsApp", /whatsapp/i],
  ["Instagram", /instagram/i],
  ["Facebook", /facebook|meta platforms|messenger|\bmeta\b/i],
  ["Google", /\bgoogle\b|youtube|gmail/i],
  ["Snapchat", /snap(chat)?\b|snap inc/i],
  ["Kik", /\bkik\b|medialab/i],
  ["X", /\bx corp\b|twitter|\bx\.com\b/i],
  ["AT&T", /at&t|att\.net/i],
  ["Discord", /discord/i],
  ["Microsoft", /microsoft|xbox|outlook|skype/i],
  ["Dropbox", /dropbox/i],
  ["TikTok", /tiktok|bytedance/i],
  ["Roblox", /roblox/i],
];

/** Detect provider from a scoped text region (falls back to "Other"). */
export function detectProvider(text: string): Provider {
  for (const [p, re] of PROVIDER_KEYWORDS) {
    if (re.test(text)) return p;
  }
  return "Other";
}

/** Map a literal ESP name (e.g. "WhatsApp Inc.", "MediaLab/Kik") to an enum. */
export function providerFromEspName(name: string): Provider {
  return detectProvider(name);
}

/**
 * For documents that enumerate many platforms in boilerplate (warrants), pick
 * the MOST-mentioned provider rather than the first keyword hit.
 */
export function detectProviderByFrequency(text: string): Provider {
  let best: Provider = "Other";
  let bestN = 0;
  for (const [p, re] of PROVIDER_KEYWORDS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const n = (text.match(g) || []).length;
    if (n > bestN) { bestN = n; best = p; }
  }
  return best;
}

/** Split labeled device ids across categories using labeled + generic hits. */
export function extractDeviceIds(text: string): DeviceIds {
  const out: DeviceIds = { imei: [], mac: [], gaid: [], idfa: [], other: [] };
  out.imei = dedupe(collect(text, RE.imeiLabeled));
  out.mac = dedupe(collect(text, RE.mac));
  out.gaid = dedupe(collect(text, RE.gaidLabeled));
  out.idfa = dedupe(collect(text, RE.idfaLabeled));
  return out;
}
