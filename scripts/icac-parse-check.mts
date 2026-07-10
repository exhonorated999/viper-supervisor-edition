// Validation harness (Node): extract text from the sample CyberTip PDFs with
// pdf.js (the same engine the browser uses) and run the ICAC parser on each.
// Prints a per-file coverage report so we can calibrate regexes before the UI.
//
// Run: npx tsx scripts/icac-parse-check.mts
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
// Legacy build works in Node (no DOM). Text extraction only.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDocument } from "../src/icac/parse/index.ts";

const UPLOADS = "C:/Users/JUSTI/Workspace/uploads";
const FILES = [
  "128656101.pdf", "211809625.pdf", "218215259.pdf", "220571687.pdf",
  "220632092.pdf", "220638714.pdf",
  "WB_CYBERTIP_DEMO.pdf", "WB_DEMO1234_SNAP.pdf",
  // CT138034350.pdf is password-protected → handled via a prompt in the app.
];

/** Build line-structured text from a PDF using pdf.js text items + hasEOL. */
async function extractText(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({
    data: bytes,
    password: "", // empty user password (owner-locked PDFs open silently)
    useSystemFonts: true,
    isEvalSupported: false,
  });
  // Do NOT loop on onPassword — if a real password is required we surface it
  // (the browser app prompts the user). Reject after the first failed attempt.
  (task as any).onPassword = (updatePassword: (p: string) => void, reason: number) => {
    if (reason === 1) { updatePassword(""); return; } // NEED_PASSWORD: try empty once
    (task as any).destroy?.();                          // INCORRECT_PASSWORD: give up
  };
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    const out: string[] = [];
    for (const it of content.items as any[]) {
      if (typeof it.str !== "string") continue;
      line += it.str;
      if (it.hasEOL) { out.push(line); line = ""; }
    }
    if (line) out.push(line);
    pages.push(out.join("\n"));
  }
  return pages.join("\n");
}

function summarize(tip: ReturnType<typeof parseDocument>) {
  const id = tip.identifiers;
  return {
    file: tip.source_file,
    type: tip.source_doc_type,
    conf: tip.parse_confidence,
    ct: tip.cybertip_number || "—",
    provider: tip.provider,
    priority: tip.priority_level || "—",
    received: tip.date_received || "—",
    incident: (tip.incident_type || "—").slice(0, 44),
    parties: tip.parties.length,
    ips: id.ip_addresses.length,
    emails: id.emails.length,
    phones: id.phone_numbers.length,
    usernames: id.usernames.length,
    espIds: id.esp_user_ids.length,
    files: tip.contraband.file_count,
    md5: tip.contraband.md5.length,
    cats: tip.contraband.categories.join(",") || "—",
    prior: tip.prior_reports.length,
    missing: tip.missing_fields.join(",") || "none",
  };
}

async function main() {
  const rows: any[] = [];
  for (const f of FILES) {
    try {
      const bytes = new Uint8Array(await readFile(path.join(UPLOADS, f)));
      const text = await Promise.race([
        extractText(bytes),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
      ]);
      const tip = parseDocument(text, f);
      rows.push(summarize(tip));
      console.log(JSON.stringify(summarize(tip)));
      if (process.env.DUMP === f) {
        console.log(`\n===== FULL RECORD ${f} =====`);
        console.log(JSON.stringify(tip, null, 2));
      }
    } catch (e: any) {
      rows.push({ file: f, type: "ERROR", conf: String(e?.message || e).slice(0, 60) });
    }
  }
  console.log("\n=== ICAC PARSE COVERAGE ===");
  for (const r of rows) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));

void fileURLToPath;
