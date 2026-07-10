// XLSX builder — a minimal but VALID multi-sheet OpenXML workbook produced with
// jszip (already a dependency). We use inlineStr cells so there is no
// sharedStrings table to maintain, and a tiny styles.xml that gives the header
// row a bold font. This avoids pulling in a heavyweight spreadsheet library
// (and its parsing-side CVEs) — we only ever WRITE, and we control the data.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import type { CyberTip } from "../types";
import { HEADERS, tipRow } from "./rows";
import { deriveDashboard } from "../derive";

type Cell = string | number;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // strip control chars Excel rejects (keep \t \n \r handling to space)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

/** 0-based column index → A, B, ..., Z, AA, AB ... */
function colRef(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function cellXml(ref: string, v: Cell, headerStyle: boolean): string {
  const style = headerStyle ? ' s="1"' : "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  const text = xmlEsc(String(v ?? ""));
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rowsXml = sheet.rows
    .map((row, ri) => {
      const cells = row
        .map((v, ci) => cellXml(colRef(ci) + (ri + 1), v, ri === 0))
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>" +
    rowsXml +
    "</sheetData></worksheet>"
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
  "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
  "</fonts>" +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  "</cellXfs>" +
  "</styleSheet>";

/** Build a real .xlsx as a Blob from an ordered list of sheets. */
export async function buildWorkbook(sheets: Sheet[]): Promise<Blob> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join("") +
      "</Types>"
  );

  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"
  );

  const sheetsTag = sheets
    .map((s, i) => `<sheet name="${xmlEsc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${sheetsTag}</sheets></workbook>`
  );

  const relTags =
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relTags +
      "</Relationships>"
  );

  zip.file("xl/styles.xml", STYLES_XML);

  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Assemble the ICAC intelligence workbook (CyberTips + Providers + Repeat Suspects + Assignments). */
export async function buildXlsx(tips: CyberTip[]): Promise<Blob> {
  const d = deriveDashboard(tips, Date.now());

  const tipsSheet: Sheet = { name: "CyberTips", rows: [HEADERS, ...tips.map(tipRow)] };

  const providersSheet: Sheet = {
    name: "Providers",
    rows: [
      ["Provider", "Tips", "Data Types", "Status", "Last Update"],
      ...d.providers.map((p) => [p.provider, p.count, p.dataTypes, p.status, p.lastUpdate] as Cell[]),
    ],
  };

  const linksSheet: Sheet = {
    name: "Repeat Suspects",
    rows: [
      ["Shared Identifier", "Type", "Tips Matched"],
      ...d.links.map((l) => [l.value, l.type, l.matches] as Cell[]),
    ],
  };

  const assignRows = tips
    .filter((t) => t.assignment?.assigned_to)
    .map(
      (t) =>
        [
          t.cybertip_number || "",
          t.assignment.assigned_to || "",
          t.assignment.priority || "",
          t.assignment.status || "sent",
          t.assignment.sentAt || "",
          t.assignment.acknowledgedAt || "",
          t.assignment.note || "",
        ] as Cell[]
    );
  const assignSheet: Sheet = {
    name: "Assignments",
    rows: [["CyberTip #", "Assigned To", "Priority", "Status", "Sent At", "Acknowledged At", "Note"], ...assignRows],
  };

  return buildWorkbook([tipsSheet, providersSheet, linksSheet, assignSheet]);
}
