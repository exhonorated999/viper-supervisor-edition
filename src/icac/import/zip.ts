// ZIP reader for CyberTip packages. Extracts PDF bytes for parsing and collects
// CONTRABAND METADATA ONLY (filenames, counts, sizes) — it never reads or
// decodes media bytes. See plan.md safety rule #2.
// ---------------------------------------------------------------------------

import JSZip from "jszip";

const PDF_RE = /\.pdf$/i;
const MEDIA_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|mp4|mov|avi|mkv|webm|wmv|flv|m4v|3gp)$/i;

export interface ZipContents {
  pdfs: { name: string; data: Uint8Array }[];
  media: { count: number; names: string[]; totalBytes: number };
  otherCount: number;
}

/** Read a ZIP: PDF bytes + media metadata (never media bytes). */
export async function readZip(bytes: Uint8Array): Promise<ZipContents> {
  const zip = await JSZip.loadAsync(bytes);
  const pdfs: { name: string; data: Uint8Array }[] = [];
  const mediaNames: string[] = [];
  let totalBytes = 0;
  let otherCount = 0;

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    const base = entry.name.split("/").pop() || entry.name;
    if (PDF_RE.test(base)) {
      const data = await entry.async("uint8array");
      pdfs.push({ name: base, data });
    } else if (MEDIA_RE.test(base)) {
      // METADATA ONLY — do not read the bytes.
      mediaNames.push(base);
      const size = (entry as any)?._data?.uncompressedSize;
      if (typeof size === "number") totalBytes += size;
    } else {
      otherCount++;
    }
  }

  return {
    pdfs,
    media: { count: mediaNames.length, names: mediaNames, totalBytes },
    otherCount,
  };
}

export function isZip(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

export function isPdf(fileName: string): boolean {
  return PDF_RE.test(fileName);
}
