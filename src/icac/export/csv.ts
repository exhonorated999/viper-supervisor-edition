// CSV builder — RFC 4180 quoting, UTF-8 BOM so Excel opens accents correctly.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";
import { HEADERS, tipRow, type Row } from "./rows";

function cell(v: string | number): string {
  const s = String(v ?? "");
  // Quote if it contains comma, quote, CR or LF; escape embedded quotes.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function line(cells: Row): string {
  return cells.map(cell).join(",");
}

export function buildCsv(tips: CyberTip[]): string {
  const rows = [line(HEADERS), ...tips.map((t) => line(tipRow(t)))];
  // \uFEFF BOM + CRLF line endings for maximum spreadsheet compatibility.
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}
