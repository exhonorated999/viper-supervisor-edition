// Flat, export-safe row model derived from CyberTip records.
//
// SAFETY NOTE: ICAC exports are LOCAL FILE DOWNLOADS only — they never cross the
// LAN. They therefore MAY contain investigative identifiers (that is their
// purpose). They can NEVER contain contraband media bytes, because the store
// only ever holds metadata (file counts / names / hashes / ESP categories).
// Handle exported files per your agency's evidence-handling policy.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";

/** How much of the record to include in an export. */
export type ExportScope = "all" | "unassigned" | "contraband";

export function filterTips(tips: CyberTip[], scope: ExportScope): CyberTip[] {
  switch (scope) {
    case "unassigned":
      return tips.filter((t) => !t.assignment?.assigned_to);
    case "contraband":
      return tips.filter((t) => (t.contraband?.file_count ?? 0) > 0);
    default:
      return tips;
  }
}

function suspectName(t: CyberTip): string {
  const s = t.parties.find((p) => p.role === "suspect" && p.name) || t.parties.find((p) => p.name);
  return s?.name ?? "";
}

/** Ordered column definitions — the single source of truth for CSV + XLSX. */
export interface Column {
  header: string;
  get: (t: CyberTip) => string | number;
}

const J = (xs: string[]) => xs.join(" | ");

export const COLUMNS: Column[] = [
  { header: "CyberTip #", get: (t) => t.cybertip_number || "" },
  { header: "Date Received", get: (t) => t.date_received || "" },
  { header: "Provider", get: (t) => t.provider },
  { header: "Incident Type", get: (t) => t.incident_type || "" },
  { header: "Priority", get: (t) => t.priority_level || "" },
  { header: "Suspect Name", get: (t) => suspectName(t) },
  { header: "Emails", get: (t) => J(t.identifiers.emails) },
  { header: "Usernames", get: (t) => J(t.identifiers.usernames) },
  { header: "Phones", get: (t) => J(t.identifiers.phone_numbers) },
  { header: "IP Addresses", get: (t) => J(t.identifiers.ip_addresses) },
  { header: "ESP User IDs", get: (t) => J(t.identifiers.esp_user_ids) },
  { header: "File Count", get: (t) => t.contraband.file_count },
  { header: "Categories", get: (t) => J(t.contraband.categories) },
  { header: "Prior CT Reports", get: (t) => J(t.prior_reports) },
  { header: "Linked Tips", get: (t) => String(t.linked_tips.length) },
  { header: "Assigned To", get: (t) => t.assignment?.assigned_to || "" },
  { header: "Assignment Status", get: (t) => (t.assignment?.assigned_to ? (t.assignment.status || "sent") : "unassigned") },
  { header: "Parse Confidence", get: (t) => t.parse_confidence },
  { header: "Source File", get: (t) => t.source_file || "" },
  { header: "Imported At", get: (t) => t.imported_at || "" },
];

/** Row = array of string/number cells in COLUMNS order. */
export type Row = (string | number)[];

export function tipRow(t: CyberTip): Row {
  return COLUMNS.map((c) => c.get(t));
}

export const HEADERS: string[] = COLUMNS.map((c) => c.header);

/** A filename-safe UTC timestamp, e.g. 20260710-142530. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "-" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}
