// Phase 6 export smoke-test. Builds each format from a couple of synthetic
// CyberTips and asserts the bytes are structurally valid:
//   CSV  → has header + BOM + row count
//   JSON → parses, round-trips tip count
//   XLSX → is a ZIP whose entries include the required OpenXML parts
//   PDF  → starts with %PDF and ends with %%EOF
// Run: npx tsx scripts\icac-export-check.mts
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { buildCsv } from "../src/icac/export/csv";
import { buildJson } from "../src/icac/export/json";
import { buildXlsx } from "../src/icac/export/xlsx";
import { buildPdf } from "../src/icac/export/pdf";
import { emptyContraband, emptyIdentifiers, type CyberTip } from "../src/icac/types";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  " + extra : ""}`); }
}

function tip(n: string, over: Partial<CyberTip> = {}): CyberTip {
  return {
    id: "id-" + n,
    cybertip_number: n,
    date_received: "07-01-2026 12:00:00 UTC",
    provider: "Snapchat",
    incident_type: "Apparent Child Pornography",
    identifiers: { ...emptyIdentifiers(), emails: ["a@b.com"], usernames: ["susp,ect"], ip_addresses: ["1.2.3.4"] },
    contraband: { ...emptyContraband(), file_count: 3, categories: ["A1", "B1"] },
    parties: [{ role: "suspect", name: 'John "JD" Doe', emails: [], usernames: [], phones: [], esp_user_ids: [], profile_urls: [], ips: [] }],
    prior_reports: [],
    linked_tips: [],
    assignment: { assigned_to: "Inv. Reyes", assigned_to_device_id: "DEV-x", priority: "High", note: "handle", status: "acknowledged", sentAt: "2026-07-01T12:00:00Z", acknowledgedAt: "2026-07-01T13:00:00Z" },
    source_file: "CT" + n + ".pdf",
    source_doc_type: "ncmec",
    parse_confidence: "high",
    missing_fields: [],
    imported_at: "2026-07-01T11:00:00Z",
    ...over,
  };
}

async function main() {
  const tips = [
    tip("111"),
    tip("222", { assignment: { assigned_to: null, priority: null, note: null }, contraband: { ...emptyContraband(), file_count: 0 } }),
  ];

  // CSV
  const csv = buildCsv(tips);
  ok("csv starts with BOM", csv.charCodeAt(0) === 0xfeff);
  const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  ok("csv header + 2 rows", lines.length === 3, `(${lines.length})`);
  ok("csv quotes embedded comma", /"susp,ect"/.test(csv));
  ok("csv quotes embedded quote", lines[1].includes('""JD""'));

  // JSON
  const json = buildJson(tips, { unit: "CID", scope: "all" });
  const parsed = JSON.parse(json);
  ok("json kind tag", parsed.kind === "viper.icac.export");
  ok("json tip_count", parsed.tip_count === 2 && parsed.tips.length === 2);

  // XLSX
  const xlsxBlob = await buildXlsx(tips);
  const xbuf = Buffer.from(await xlsxBlob.arrayBuffer());
  ok("xlsx is a zip (PK)", xbuf[0] === 0x50 && xbuf[1] === 0x4b, `${xbuf.length}B`);
  const zip = await JSZip.loadAsync(xbuf);
  const need = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet4.xml"];
  ok("xlsx has all required parts", need.every((p) => zip.file(p) != null), need.filter((p) => !zip.file(p)).join(",") || "");
  const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  ok("xlsx sheet1 escapes quote entity", s1.includes("&quot;JD&quot;"));
  ok("xlsx sheet1 has inlineStr", s1.includes('t="inlineStr"'));

  // PDF
  const pdfBlob = await buildPdf(tips, { unit: "CID", scope: "all" });
  const pbuf = Buffer.from(await pdfBlob.arrayBuffer());
  const head = pbuf.subarray(0, 5).toString("latin1");
  const tail = pbuf.subarray(-6).toString("latin1");
  ok("pdf header %PDF-", head === "%PDF-", `${pbuf.length}B`);
  ok("pdf ends with EOF", tail.includes("EOF"));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
