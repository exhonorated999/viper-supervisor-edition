// Verify the dashboard derive layer on the real sample reports.
// Run: npx tsx scripts/icac-dash-check.mts
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDocument } from "../src/icac/parse/index.ts";
import { deriveDashboard } from "../src/icac/derive.ts";

const UPLOADS = "C:/Users/JUSTI/Workspace/uploads";
const FILES = ["128656101.pdf","211809625.pdf","218215259.pdf","220571687.pdf","220632092.pdf","220638714.pdf","WB_CYBERTIP_DEMO.pdf","WB_DEMO1234_SNAP.pdf"];

async function extract(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({ data: bytes, password: "", isEvalSupported: false });
  (task as any).onPassword = (u: (p: string) => void, r: number) => { if (r === 1) u(""); else task.destroy(); };
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    let line = ""; const out: string[] = [];
    for (const it of c.items as any[]) { if (typeof it.str !== "string") continue; line += it.str; if (it.hasEOL) { out.push(line); line = ""; } }
    if (line) out.push(line); pages.push(out.join("\n"));
  }
  return pages.join("\n");
}

async function main() {
  const tips = [];
  for (const f of FILES) {
    const text = await extract(new Uint8Array(await readFile(path.join(UPLOADS, f))));
    tips.push(parseDocument(text, f));
  }
  const d = deriveDashboard(tips);
  console.log("TILES:", JSON.stringify(d.tiles.map((t) => `${t.label}=${t.value}`)));
  console.log("PROVIDERS:", JSON.stringify(d.providers.map((p) => `${p.provider}:${p.count}/${p.status}`)));
  console.log("LINKS(top):", JSON.stringify(d.links.slice(0, 5).map((l) => `${l.type} ${l.value.slice(0,22)} x${l.matches}`)));
  console.log("DONUT:", JSON.stringify(d.donut.map((s) => `${s.code}=${s.count}`)));
  console.log("TIMELINE pts:", d.timeline.length, "ALERTS:", d.alerts.length, "RECENT:", d.recent.length);
  console.log("HEATMAP cols:", d.heatmap.map((h) => `${h.type}:${h.cells.length}`).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
