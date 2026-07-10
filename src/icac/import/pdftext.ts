// Browser PDF → text extraction using pdf.js. Produces LINE-STRUCTURED text
// (grouped by pdf.js item.hasEOL) — the exact shape the ICAC parser expects and
// the same reconstruction validated by scripts/icac-parse-check.mts in Node.
// ---------------------------------------------------------------------------

// Install the Uint8Array hex/base64 shim on the MAIN thread too (cheap, and
// guards any future main-thread pdf.js code path on Electron 33 / Chromium 130).
import "../../polyfills/uint8-hex-base64";
import * as pdfjs from "pdfjs-dist";
// Custom worker wrapper that shims Uint8Array.toHex/fromBase64 in the worker
// scope before pdf.js loads. pdf.js v6 calls these methods, which are absent in
// Electron 33's Chromium 130 — see src/polyfills/uint8-hex-base64.ts.
import PdfWorker from "./pdf-worker?worker";

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

/** Thrown when a PDF needs a password we don't have — the UI prompts the user. */
export class PasswordRequiredError extends Error {
  constructor(public readonly fileName: string) {
    super(`Password required: ${fileName}`);
    this.name = "PasswordRequiredError";
  }
}

/**
 * Extract line-structured text from a PDF.
 * @param data   raw PDF bytes
 * @param opts.fileName  for error messages
 * @param opts.password  optional user-supplied password (empty tried by default)
 */
export async function extractPdfText(
  data: Uint8Array,
  opts: { fileName?: string; password?: string } = {},
): Promise<string> {
  const fileName = opts.fileName ?? "document.pdf";
  const task = pdfjs.getDocument({
    data,
    password: opts.password ?? "",
    isEvalSupported: false,
  } as any);
  // Try empty password once for owner-locked PDFs; otherwise surface a prompt.
  (task as any).onPassword = (updatePassword: (p: string) => void, reason: number) => {
    // reason 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
    if (reason === 1 && !opts.password) { updatePassword(""); return; }
    task.destroy(); // rejects task.promise → handled below
  };

  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e: any) {
    if (e?.name === "PasswordException" || e instanceof PasswordRequiredError) {
      throw new PasswordRequiredError(fileName);
    }
    throw e;
  }

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const out: string[] = [];
    let line = "";
    for (const it of content.items as any[]) {
      if (typeof it.str !== "string") continue;
      line += it.str;
      if (it.hasEOL) { out.push(line); line = ""; }
    }
    if (line) out.push(line);
    pages.push(out.join("\n"));
    page.cleanup();
  }
  await (doc as any).destroy?.();
  return pages.join("\n");
}
