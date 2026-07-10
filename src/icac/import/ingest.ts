// Ingest orchestrator: accepts dropped/selected files (ZIPs AND loose PDFs),
// extracts text, runs the parser, and folds ZIP contraband metadata into the
// resulting CyberTip records. Emits per-file progress for the import queue UI.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";
import { parseDocument } from "../parse/index";
import { extractPdfText, PasswordRequiredError } from "./pdftext";
import { readZip, isZip, isPdf, type ZipContents } from "./zip";

/** Status colors used by the import queue (see plan.md §7.3). */
export type IngestStatus =
  | "queued"       // grey
  | "extracting"   // blue
  | "parsing"      // cyan
  | "complete"     // green
  | "partial"      // amber (parsed but low confidence / password / no CT#)
  | "error";       // red

export interface IngestProgress {
  fileName: string;
  status: IngestStatus;
  detail?: string;
  pdfsFound?: number;
  contraband?: number;
  provider?: string;
}

export interface IngestResult {
  tips: CyberTip[];
  progress: IngestProgress[];
}

type ProgressCb = (p: IngestProgress) => void;

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Attach ZIP media metadata to the best-matching tip (the NCMEC report). */
function foldZipMedia(tips: CyberTip[], zip: ZipContents): void {
  if (!zip.media.count) return;
  const target = tips.find((t) => t.source_doc_type === "ncmec") ?? tips[0];
  if (!target) return;
  // Prefer names actually present in the ZIP; keep counts authoritative.
  const merged = Array.from(new Set([...target.contraband.file_names, ...zip.media.names]));
  target.contraband.file_names = merged;
  target.contraband.file_count = Math.max(target.contraband.file_count, zip.media.count);
  if (zip.media.totalBytes) target.contraband.total_bytes = zip.media.totalBytes;
}

function statusFor(tip: CyberTip): IngestStatus {
  if (tip.parse_confidence === "low" || !tip.cybertip_number) return "partial";
  return "complete";
}

async function ingestOnePdf(
  name: string,
  data: Uint8Array,
  onProgress: ProgressCb,
): Promise<CyberTip | null> {
  try {
    onProgress({ fileName: name, status: "extracting" });
    const text = await extractPdfText(data, { fileName: name });
    onProgress({ fileName: name, status: "parsing" });
    const tip = parseDocument(text, name);
    onProgress({
      fileName: name,
      status: statusFor(tip),
      provider: tip.provider,
      contraband: tip.contraband.file_count,
      detail: tip.cybertip_number ? `CT# ${tip.cybertip_number}` : "no CyberTip # found",
    });
    return tip;
  } catch (e: any) {
    const detail = e instanceof PasswordRequiredError ? "password required" : String(e?.message || e);
    onProgress({ fileName: name, status: e instanceof PasswordRequiredError ? "partial" : "error", detail });
    return null;
  }
}

/** Ingest a list of user files. Safe to call with a mix of ZIPs and PDFs. */
export async function ingestFiles(
  files: File[],
  onProgress: ProgressCb = () => {},
): Promise<IngestResult> {
  const tips: CyberTip[] = [];
  const progress: IngestProgress[] = [];
  const track: ProgressCb = (p) => { progress.push(p); onProgress(p); };

  for (const file of files) {
    const name = file.name;
    try {
      if (isZip(name)) {
        track({ fileName: name, status: "extracting", detail: "reading archive" });
        const zip = await readZip(await bytesOf(file));
        track({ fileName: name, status: "parsing", pdfsFound: zip.pdfs.length, contraband: zip.media.count });
        const zipTips: CyberTip[] = [];
        for (const pdf of zip.pdfs) {
          const tip = await ingestOnePdf(`${name} › ${pdf.name}`, pdf.data, track);
          if (tip) zipTips.push(tip);
        }
        foldZipMedia(zipTips, zip);
        tips.push(...zipTips);
        track({
          fileName: name,
          status: zipTips.length ? "complete" : "error",
          detail: zipTips.length ? `${zipTips.length} report(s), ${zip.media.count} media` : "no PDFs found",
          pdfsFound: zip.pdfs.length,
          contraband: zip.media.count,
        });
      } else if (isPdf(name)) {
        const tip = await ingestOnePdf(name, await bytesOf(file), track);
        if (tip) tips.push(tip);
      } else {
        track({ fileName: name, status: "error", detail: "unsupported file type" });
      }
    } catch (e: any) {
      track({ fileName: name, status: "error", detail: String(e?.message || e) });
    }
  }

  return { tips, progress };
}
