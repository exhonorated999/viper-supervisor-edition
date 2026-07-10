// Parser dispatch: detect document type from extracted text, route to the
// right extractor, and expose a single parseDocument() entry point.
// ---------------------------------------------------------------------------

import type { CyberTip, SourceDocType } from "../types";
import { normalizeText } from "./util";
import { parseNcmec } from "./ncmec";
import { parseWarrant } from "./warrant";

export function detectDocType(text: string): SourceDocType {
  if (/CyberTipline Report\s+#?\s*\d+/i.test(text)) return "ncmec";
  if (/SEARCH WARRANT|AGENCY CASE NUMBER/i.test(text)) return "warrant";
  return "unknown";
}

/**
 * Parse one document's extracted text into a CyberTip record.
 * `sourceFile` is the original filename (for provenance).
 */
export function parseDocument(rawText: string, sourceFile: string): CyberTip {
  const text = normalizeText(rawText);
  const type = detectDocType(text);
  if (type === "ncmec") return parseNcmec(text, sourceFile);
  if (type === "warrant") return parseWarrant(text, sourceFile);
  // Unknown: run NCMEC extractor anyway (its generic sweeps still capture
  // identifiers) but mark it unknown/low so the reviewer knows to verify.
  const tip = parseNcmec(text, sourceFile);
  tip.source_doc_type = "unknown";
  tip.parse_confidence = "low";
  if (!tip.missing_fields.includes("doc_type")) tip.missing_fields.push("doc_type");
  return tip;
}

export { parseNcmec, parseWarrant };
