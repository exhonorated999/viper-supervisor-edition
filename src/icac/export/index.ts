// Export orchestration — turns the CyberTip store into a downloadable file in
// the chosen format, scoped as requested. The ONLY module the UI calls.
//
// Everything here is a LOCAL file download; nothing touches the LAN.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";
import { filterTips, stamp, type ExportScope } from "./rows";
import { buildCsv } from "./csv";
import { buildJson } from "./json";
import { buildXlsx } from "./xlsx";
import { buildPdf } from "./pdf";

export type ExportFormat = "csv" | "xlsx" | "json" | "pdf";
export type { ExportScope } from "./rows";

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  unit: string;
  tips: CyberTip[];
}

export interface ExportResult {
  filename: string;
  count: number;
}

const EXT: Record<ExportFormat, string> = { csv: "csv", xlsx: "xlsx", json: "json", pdf: "pdf" };

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Build + trigger a download. Returns the filename and included tip count. */
export async function runExport(req: ExportRequest): Promise<ExportResult> {
  const scoped = filterTips(req.tips, req.scope);
  const filename = `icac-${req.scope}-${stamp()}.${EXT[req.format]}`;

  let blob: Blob;
  switch (req.format) {
    case "csv":
      blob = new Blob([buildCsv(scoped)], { type: "text/csv;charset=utf-8" });
      break;
    case "json":
      blob = new Blob([buildJson(scoped, { unit: req.unit, scope: req.scope })], {
        type: "application/json;charset=utf-8",
      });
      break;
    case "xlsx":
      blob = await buildXlsx(scoped);
      break;
    case "pdf":
      blob = await buildPdf(scoped, { unit: req.unit, scope: req.scope });
      break;
  }

  download(blob, filename);
  return { filename, count: scoped.length };
}
