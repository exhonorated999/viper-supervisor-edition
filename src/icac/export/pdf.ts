// PDF builder — a one-page ICAC command summary (metrics + provider breakdown
// + active alerts). Metadata only; no media, no full identifier dumps. Intended
// as a briefing artifact, not an evidence export (use CSV/XLSX/JSON for detail).
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { CyberTip } from "../types";
import { deriveDashboard } from "../derive";

const CYAN = rgb(0.0, 0.717, 0.764);
const INK = rgb(0.11, 0.13, 0.16);
const DIM = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.85, 0.87, 0.9);

export interface PdfMeta {
  unit: string;
  scope: string;
}

export async function buildPdf(tips: CyberTip[], meta: PdfMeta): Promise<Blob> {
  const d = deriveDashboard(tips, Date.now());
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([612, 792]); // US Letter
  const M = 48;
  const W = 612 - M * 2;
  let y = 792 - M;

  const text = (
    p: PDFPage, s: string, x: number, yy: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}
  ) => {
    p.drawText(s, { x, y: yy, size: opts.size ?? 10, font: opts.font ?? font, color: opts.color ?? INK });
  };

  // Header band
  page.drawRectangle({ x: 0, y: 792 - 8, width: 612, height: 8, color: CYAN });
  text(page, "V.I.P.E.R. — ICAC Command Summary", M, y - 6, { font: bold, size: 18 });
  y -= 26;
  text(page, `${meta.unit}  ·  scope: ${meta.scope}  ·  ${tips.length} tips`, M, y - 6, { color: DIM, size: 10 });
  y -= 14;
  text(page, `Generated ${new Date().toUTCString()}`, M, y - 6, { color: DIM, size: 9 });
  y -= 26;

  // Metric tiles (2 rows of up to 4)
  const tiles = d.tiles.slice(0, 8);
  const perRow = 4;
  const gap = 10;
  const tw = (W - gap * (perRow - 1)) / perRow;
  const th = 56;
  tiles.forEach((t, i) => {
    const col = i % perRow;
    const rowN = Math.floor(i / perRow);
    const x = M + col * (tw + gap);
    const ty = y - rowN * (th + gap);
    page.drawRectangle({ x, y: ty - th, width: tw, height: th, borderColor: LINE, borderWidth: 1, color: rgb(0.98, 0.98, 0.99) });
    text(page, String(t.value), x + 10, ty - 26, { font: bold, size: 20, color: CYAN });
    text(page, t.label.toUpperCase(), x + 10, ty - 40, { size: 6.5, color: DIM });
    if (t.sub) text(page, t.sub.slice(0, 22), x + 10, ty - 50, { size: 6.5, color: DIM });
  });
  const tileRows = Math.ceil(tiles.length / perRow);
  y -= tileRows * (th + gap) + 12;

  // Provider breakdown table
  text(page, "Provider Intelligence", M, y, { font: bold, size: 12 });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: LINE });
  y -= 16;
  const cols = [M, M + 200, M + 260, M + 360, M + 470];
  text(page, "PROVIDER", cols[0], y, { font: bold, size: 8, color: DIM });
  text(page, "TIPS", cols[1], y, { font: bold, size: 8, color: DIM });
  text(page, "DATA TYPES", cols[2], y, { font: bold, size: 8, color: DIM });
  text(page, "STATUS", cols[3], y, { font: bold, size: 8, color: DIM });
  text(page, "UPDATED", cols[4], y, { font: bold, size: 8, color: DIM });
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINE });
  y -= 14;
  for (const p of d.providers.slice(0, 8)) {
    text(page, String(p.provider).slice(0, 32), cols[0], y, { size: 9 });
    text(page, String(p.count), cols[1], y, { size: 9 });
    text(page, p.dataTypes.slice(0, 18), cols[2], y, { size: 8, color: DIM });
    text(page, p.status, cols[3], y, { size: 9, color: p.status === "Complete" ? rgb(0.29, 0.62, 0.29) : rgb(0.86, 0.6, 0.02) });
    text(page, p.lastUpdate.slice(0, 14), cols[4], y, { size: 8, color: DIM });
    y -= 15;
  }
  if (!d.providers.length) { text(page, "No providers yet.", M, y, { size: 9, color: DIM }); y -= 15; }
  y -= 10;

  // Active alerts
  text(page, `Active Alerts (${d.alerts.length})`, M, y, { font: bold, size: 12 });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: LINE });
  y -= 16;
  const alertColor: Record<string, ReturnType<typeof rgb>> = {
    repeat: rgb(0.86, 0.33, 0.33),
    warrant: rgb(0.86, 0.6, 0.02),
    unassigned: rgb(0.0, 0.47, 0.83),
    password: rgb(0.55, 0.36, 0.86),
    contraband: rgb(0.86, 0.33, 0.33),
  };
  const shown = d.alerts.slice(0, Math.max(1, Math.floor((y - M - 40) / 15)));
  for (const a of shown) {
    page.drawCircle({ x: M + 3, y: y + 3, size: 3, color: alertColor[a.kind] ?? DIM });
    text(page, a.text.slice(0, 95), M + 14, y, { size: 9 });
    y -= 15;
  }
  if (!d.alerts.length) { text(page, "No active alerts.", M, y, { size: 9, color: DIM }); y -= 15; }

  // Confidentiality footer
  page.drawLine({ start: { x: M, y: M + 22 }, end: { x: M + W, y: M + 22 }, thickness: 0.5, color: LINE });
  text(page, "LAW ENFORCEMENT SENSITIVE — Summary contains metadata only (no contraband media).", M, M + 10, { size: 7.5, color: DIM });
  text(page, "Handle per agency policy. Not for LAN transmission.", M, M + 1, { size: 7.5, color: DIM });

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
