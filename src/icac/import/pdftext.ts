// Browser PDF → text extraction using pdf.js. Produces LINE-STRUCTURED text
// (grouped by pdf.js item.hasEOL) — the exact shape the ICAC parser expects and
// the same reconstruction validated by scripts/icac-parse-check.mts in Node.
// ---------------------------------------------------------------------------

import * as pdfjs from "pdfjs-dist";
// Vite resolves this to a hashed asset URL for the worker module.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

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
