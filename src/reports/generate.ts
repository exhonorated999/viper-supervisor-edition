// ---------------------------------------------------------------------------
// Quick Reports — one-click PDF briefings generated locally with pdf-lib from
// the dashboard's current data (unit metrics, case-status breakdown, workload,
// OPS plans). Nothing leaves the machine: the PDF is built in the renderer and
// downloaded. Mirrors Project V.I.P.E.R.'s Generate Report, adapted to the
// supervisor's unit-wide data.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { CaseStatus, InvestigatorWorkload, OpsPlan, CaseBreakdownSlice } from "../types";
import { metricDef, formatMetricValue } from "../data/metrics";
import { periodLabel, type PeriodKey, type PeriodMetrics } from "../data/periods";
import { reportFilename, type ReportPayload, type SectionId } from "./payload";

const CYAN = rgb(0.0, 0.717, 0.764);
const INK = rgb(0.11, 0.13, 0.16);
const DIM = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.85, 0.87, 0.9);
const BAND = rgb(0.1, 0.12, 0.15);

export type ReportKind = "monthly" | "ytd" | "investigator" | "distribution" | "ops";

export interface ReportData {
  supervisor: { name?: string; badge?: string; unit?: string };
  /** All-time unit totals (kept for the non-period report kinds). */
  metricValues: Record<string, number>;
  /**
   * Period-bucketed unit metrics. The Monthly Summary reports month-to-date
   * and the YTD Overview reports year-to-date off this, each with the lifetime
   * total alongside, so a printed report matches the dashboard exactly.
   */
  periods?: PeriodMetrics;
  cardKeys: string[];
  quickKeys: string[];
  breakdown: CaseBreakdownSlice[];
  totalCases: number;
  workload: InvestigatorWorkload[];
  cases: CaseStatus[];
  opsPending: OpsPlan[];
  opsSigned: OpsPlan[];
}

const REPORT_META: Record<ReportKind, { title: string; period: string }> = {
  monthly: { title: "Monthly Summary", period: "Month to Date" },
  ytd: { title: "YTD Overview", period: "Year to Date" },
  investigator: { title: "Investigator Performance", period: "Current" },
  distribution: { title: "Case Distribution", period: "Current" },
  ops: { title: "OPS Plan Log", period: "All" },
};

// The standard PDF fonts are WinAnsi-encoded; pdf-lib throws on any codepoint
// outside that set. Case numbers and OPS titles come off the wire from another
// machine, so anything exotic (emoji, CJK, smart glyphs Word invented) has to
// be folded down rather than allowed to abort the whole report.
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function sanitize(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13) out += " ";
    else if (c >= 0x20 && c <= 0xff) out += ch;
    else if (WINANSI_EXTRAS.has(c)) out += ch;
    else out += "?";
  }
  return out;
}

// Small stateful layout helper over a single logical document.
class Doc {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly M = 48;
  readonly W = 612 - 48 * 2;
  title: string;
  subtitle: string;

  constructor(title: string, subtitle: string) {
    this.title = title;
    this.subtitle = subtitle;
  }

  async init() {
    this.doc = await PDFDocument.create();
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage(true);
  }

  newPage(first = false) {
    this.page = this.doc.addPage([612, 792]);
    this.y = 792 - this.M;
    // top accent
    this.page.drawRectangle({ x: 0, y: 784, width: 612, height: 8, color: CYAN });
    if (first) {
      this.text("V.I.P.E.R. — Supervisor Edition", this.M, this.y - 6, { font: this.bold, size: 18 });
      this.y -= 24;
      this.text(this.title, this.M, this.y - 6, { font: this.bold, size: 13, color: CYAN });
      this.y -= 16;
      // The subtitle carries scope + filters + identity and can run long, so
      // wrap it instead of letting it run off the right edge of the page.
      this.wrap(this.subtitle, this.W, 9).forEach((line) => {
        this.text(line, this.M, this.y - 6, { color: DIM, size: 9 });
        this.y -= 12;
      });
      this.y -= 10;
    } else {
      this.y -= 8;
    }
  }

  ensure(space: number) {
    if (this.y - space < this.M + 24) this.newPage();
  }

  text(
    s: string, x: number, yy: number,
    o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}
  ) {
    this.page.drawText(sanitize(s), { x, y: yy, size: o.size ?? 10, font: o.font ?? this.font, color: o.color ?? INK });
  }

  sectionHeader(label: string) {
    this.ensure(30);
    this.y -= 6;
    this.page.drawRectangle({ x: this.M, y: this.y - 16, width: this.W, height: 20, color: BAND });
    this.text(label, this.M + 8, this.y - 11, { font: this.bold, size: 10, color: CYAN });
    this.y -= 30;
  }

  /**
   * Longest prefix of `s` that fits `maxW` at `size`, ellipsised if truncated.
   *
   * Measured with the real font metrics rather than a characters-per-point
   * guess — a guess is wrong by a factor of two between 6.5pt label text and
   * 15pt bold figures, which is how labels ended up underneath their values.
   */
  fit(s: string, maxW: number, size: number, font: PDFFont = this.font): string {
    const t = sanitize(s);
    if (maxW <= 0) return "";
    if (font.widthOfTextAtSize(t, size) <= maxW) return t;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (font.widthOfTextAtSize(t.slice(0, mid) + "…", size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? t.slice(0, lo).trimEnd() + "…" : "";
  }

  /** Greedy word wrap to `maxW`. Never returns an empty array. */
  wrap(s: string, maxW: number, size: number, font: PDFFont = this.font): string[] {
    const words = sanitize(s).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxW) {
        line = next;
      } else {
        if (line) lines.push(line);
        // A single word longer than the column has to be hard-clipped.
        line = font.widthOfTextAtSize(w, size) <= maxW ? w : this.fit(w, maxW, size, font);
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * Two-up stat boxes: a large figure with its label beneath.
   *
   * Geometry is expressed as offsets from the box edges so the figure and the
   * label can never collide: the value baseline sits 20pt below the top edge
   * and the label baseline 10pt above the bottom edge of a 42pt box, leaving
   * a few points of clear air between the value's descender and the label's
   * cap height.
   */
  keyValueGrid(rows: { label: string; value: string }[]) {
    const gutter = 12;
    const colW = this.W / 2;
    const boxW = colW - gutter;
    const padX = 10;
    const rowH = 42;
    const gapY = 8;
    const innerW = boxW - padX * 2;

    rows.forEach((r, i) => {
      const col = i % 2;
      if (col === 0) this.ensure(rowH + gapY);
      const x = this.M + col * colW;
      const yTop = this.y;
      const yBot = yTop - rowH;

      this.page.drawRectangle({
        x, y: yBot, width: boxW, height: rowH,
        borderColor: LINE, borderWidth: 1, color: rgb(0.98, 0.98, 0.99),
      });
      this.text(this.fit(r.value, innerW, 15, this.bold), x + padX, yTop - 20, {
        font: this.bold, size: 15, color: INK,
      });
      this.text(this.fit(r.label.toUpperCase(), innerW, 7), x + padX, yBot + 10, {
        size: 7, color: DIM,
      });

      if (col === 1 || i === rows.length - 1) this.y -= rowH + gapY;
    });
  }

  table(headers: string[], widths: number[], rows: string[][]) {
    const rowH = 18;
    const padX = 4;
    const drawHead = () => {
      this.ensure(rowH * 2);
      let x = this.M;
      this.page.drawRectangle({ x: this.M, y: this.y - rowH + 4, width: this.W, height: rowH, color: BAND });
      headers.forEach((h, i) => {
        this.text(this.fit(h, widths[i] - padX * 2, 8, this.bold), x + padX, this.y - 9, {
          font: this.bold, size: 8, color: CYAN,
        });
        x += widths[i];
      });
      this.y -= rowH;
    };
    drawHead();
    rows.forEach((r) => {
      // Re-draw the header whenever a row spills onto a fresh page. Comparing
      // the page object is reliable; comparing this.y to an expected float was
      // not.
      const pageBefore = this.page;
      this.ensure(rowH);
      if (this.page !== pageBefore) drawHead();
      let x = this.M;
      r.forEach((c, i) => {
        this.text(this.fit(c, widths[i] - padX * 2, 8), x + padX, this.y - 9, { size: 8, color: INK });
        x += widths[i];
      });
      this.page.drawLine({
        start: { x: this.M, y: this.y - rowH + 3 },
        end: { x: this.M + this.W, y: this.y - rowH + 3 },
        thickness: 0.5, color: LINE,
      });
      this.y -= rowH;
    });
    this.y -= 6;
  }

  clip(s: string, w: number): string {
    return this.fit(s, w - 8, 8);
  }

  /** A dim note. Wraps to the content width and flows across pages. */
  paragraph(s: string, o: { size?: number; color?: ReturnType<typeof rgb> } = {}) {
    const size = o.size ?? 9;
    const lineH = size + 4;
    this.wrap(s, this.W, size).forEach((line) => {
      this.ensure(lineH);
      this.text(line, this.M, this.y - size, { size, color: o.color ?? DIM });
      this.y -= lineH;
    });
    this.y -= 4;
  }

  finalize(): Promise<Uint8Array> {
    // Footer on every page.
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText("CONFIDENTIAL — LAW ENFORCEMENT USE ONLY", { x: this.M, y: 24, size: 7, font: this.font, color: DIM });
      p.drawText(`Page ${i + 1} of ${pages.length}`, { x: 612 - this.M - 60, y: 24, size: 7, font: this.font, color: DIM });
    });
    return this.doc.save();
  }
}

/**
 * Metric rows for a report. When the report is period-scoped (Monthly / YTD)
 * and the unit has period data, the BIG figure is the period value and the
 * lifetime total rides along in the small label beneath it — so the printed
 * card matches the dashboard card, and a long currency pair like
 * "$1,284,500 / $9,120,775" never has to be crammed into one 15pt line.
 */
function metricRows(
  d: ReportData,
  keys: string[],
  period: PeriodKey = "allTime"
): { label: string; value: string }[] {
  const usePeriod = period !== "allTime" && !!d.periods?.hasPeriodData;
  return keys.map((k) => {
    const label = metricDef(k).label;
    if (!usePeriod) {
      return { label, value: formatMetricValue(k, d.metricValues[k] ?? 0) };
    }
    const pv = d.periods!.buckets[period][k];
    const at = d.periods!.buckets.allTime[k] ?? d.metricValues[k] ?? 0;
    if (pv == null) {
      // No period dimension for this metric — report the lifetime figure and
      // say so, rather than printing a zero. The suffix has to differ from the
      // normal one or the reader cannot tell which number the box is showing.
      return { label: `${label} · all-time only`, value: formatMetricValue(k, at) };
    }
    return {
      label: `${label} · all time ${formatMetricValue(k, at)}`,
      value: formatMetricValue(k, pv),
    };
  });
}

async function build(kind: ReportKind, d: ReportData): Promise<Uint8Array> {  const meta = REPORT_META[kind];
  // Monthly/YTD carry a real period; name the exact window in the header.
  const reportPeriod: PeriodKey =
    kind === "monthly" ? "month" : kind === "ytd" ? "year" : "allTime";
  const periodText =
    reportPeriod !== "allTime" && d.periods
      ? `${meta.period} — ${periodLabel(reportPeriod, d.periods.labels)}`
      : meta.period;
  const who = [d.supervisor.name, d.supervisor.badge && `Badge ${d.supervisor.badge}`, d.supervisor.unit]
    .filter(Boolean)
    .join("  ·  ");
  const sub = `${periodText}  ·  Generated ${new Date().toLocaleString()}${who ? "  ·  " + who : ""}`;
  const doc = new Doc(meta.title, sub);
  await doc.init();

  if (kind === "monthly" || kind === "ytd") {
    doc.sectionHeader("Key Metrics");
    doc.keyValueGrid(metricRows(d, d.cardKeys.length ? d.cardKeys : d.quickKeys, reportPeriod));
    doc.sectionHeader("Quick Stats");
    doc.keyValueGrid(metricRows(d, d.quickKeys, reportPeriod));
    doc.sectionHeader("Case Status Breakdown");
    if (d.breakdown.length) {
      doc.table(
        ["Status", "Count", "Share"],
        [doc.W - 200, 100, 100],
        d.breakdown.map((b) => [b.state, String(b.count), `${b.pct}%`]).concat([["Total", String(d.totalCases), "100%"]])
      );
    } else {
      doc.paragraph("No case-status data received yet.");
    }
  } else if (kind === "investigator") {
    doc.sectionHeader("Investigator Workload");
    if (d.workload.length) {
      doc.table(
        ["Investigator", "Total", "Open", "Ongoing", "Aging", "New", "Band"],
        [doc.W - 300, 50, 50, 60, 50, 40, 50],
        d.workload.map((w) => [w.name, String(w.total), String(w.open), String(w.ongoing), String(w.aging), String(w.newMtd), w.band])
      );
    } else {
      doc.paragraph("No investigators reporting yet.");
    }
  } else if (kind === "distribution") {
    doc.sectionHeader("Case Distribution");
    if (d.breakdown.length) {
      doc.keyValueGrid(d.breakdown.map((b) => ({ label: `${b.state} (${b.pct}%)`, value: String(b.count) })));
    } else {
      doc.paragraph("No case-status data received yet.");
    }
    doc.sectionHeader("Recent Cases");
    if (d.cases.length) {
      doc.table(
        ["Case", "Detective", "State", "Last Activity"],
        [130, 150, 90, doc.W - 370],
        d.cases.slice(0, 24).map((c) => [c.caseNumber, c.detective, c.state, c.lastActivity])
      );
    } else {
      doc.paragraph("No cases mirrored yet.");
    }
  } else if (kind === "ops") {
    doc.sectionHeader("Pending Approval");
    if (d.opsPending.length) {
      doc.table(
        ["OPS ID", "Title", "Detective", "Risk"],
        [110, doc.W - 340, 130, 100],
        d.opsPending.map((p) => [p.id, p.title, p.detective, p.risk])
      );
    } else {
      doc.paragraph("No OPS plans awaiting approval.");
    }
    doc.sectionHeader("Signed / Returned");
    if (d.opsSigned.length) {
      doc.table(
        ["OPS ID", "Title", "Status", "By"],
        [110, doc.W - 340, 90, 140],
        d.opsSigned.map((p) => [p.id, p.title, p.status, p.signedBy || "—"])
      );
    } else {
      doc.paragraph("No signed or returned OPS plans yet.");
    }
  }

  return doc.finalize();
}

function download(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Build + download a Quick Report PDF. */
export async function generateReport(kind: ReportKind, d: ReportData): Promise<string> {
  const bytes = await build(kind, d);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `VIPER_Supervisor_${REPORT_META[kind].title.replace(/\s+/g, "_")}_${date}.pdf`;
  download(bytes, filename);
  return filename;
}

/** Build a Quick Report to raw PDF bytes (no download). Exposed for tests. */
export { build as buildQuickReport };

// ---------------------------------------------------------------------------
//
// The Quick Reports path above builds straight from live dashboard state. The
// Reports page instead resolves everything first (scope, filters, withheld
// figures, caveats) into a ReportPayload, then hands the SAME object to the
// preview, this PDF renderer and the interactive HTML exporter — so the file
// on disk always matches what was on screen.
// ---------------------------------------------------------------------------

function renderSection(doc: Doc, id: SectionId, p: ReportPayload) {
  if (id === "metrics") {
    doc.sectionHeader("Unit Metrics");
    if (!p.metrics.length) {
      doc.paragraph("No metrics selected.");
      return;
    }
    doc.table(
      ["Metric", p.scope.label, "All time"],
      [doc.W - 260, 140, 120],
      p.metrics.map((m) => [m.label, m.value ?? "—", m.allTime])
    );
    // Explain the dashes once, grouped by reason, rather than trying to cram
    // a sentence into a 140pt column.
    const withheld = p.metrics.filter((m) => m.value == null);
    if (withheld.length) {
      const byNote = new Map<string, string[]>();
      withheld.forEach((m) => {
        const note = m.note || "Not available for this window";
        byNote.set(note, [...(byNote.get(note) || []), m.label]);
      });
      byNote.forEach((labels, note) => {
        doc.paragraph(`— ${note}: ${labels.join(", ")}.`);
      });
    }
    return;
  }

  if (id === "activity") {
    doc.sectionHeader(`Case Activity — ${p.scope.label}`);
    const rows = p.activity.filter((a) => a.key !== "totalEvents");
    if (p.activity.every((a) => a.value === 0)) {
      doc.paragraph("No dated case activity in this window.");
      return;
    }
    doc.keyValueGrid(rows.map((a) => ({ label: a.label, value: String(a.value) })));
    return;
  }

  if (id === "trend") {
    doc.sectionHeader("Activity Trend");
    if (!p.series.length) {
      doc.paragraph("Not enough dated activity to plot a trend.");
      return;
    }
    doc.table(
      ["Period", "Opened", "Closed", "Arrests", "Warrants"],
      [doc.W - 320, 80, 80, 80, 80],
      p.series.map((b) => [b.label, String(b.opened), String(b.closed), String(b.arrests), String(b.warrants)])
    );
    return;
  }

  if (id === "breakdown") {
    doc.sectionHeader("Case Status Breakdown");
    if (!p.breakdown.length) {
      doc.paragraph("No case-status data received yet.");
      return;
    }
    doc.table(
      ["Status", "Count", "Share"],
      [doc.W - 200, 100, 100],
      p.breakdown
        .map((b) => [b.state, String(b.count), `${b.pct}%`])
        .concat([["Total", String(p.totalCases), "100%"]])
    );
    return;
  }

  if (id === "workload") {
    doc.sectionHeader("Investigator Workload");
    if (!p.workload.length) {
      doc.paragraph("No investigators reporting yet.");
      return;
    }
    doc.table(
      ["Investigator", "Total", "Open", "Ongoing", "Aging", "New", "Band"],
      [doc.W - 300, 50, 50, 60, 50, 40, 50],
      p.workload.map((w) => [
        w.name, String(w.total), String(w.open), String(w.ongoing), String(w.aging), String(w.newMtd), w.band,
      ])
    );
    return;
  }

  if (id === "cases") {
    doc.sectionHeader(`Cases (${p.cases.length})`);
    if (!p.cases.length) {
      doc.paragraph("No cases match this scope and filter.");
      return;
    }
    doc.table(
      ["Case", "Detective", "State", "Age", "Last Activity"],
      [110, 120, 70, 45, doc.W - 345],
      p.cases.slice(0, 200).map((c) => [
        c.caseNumber, c.detective, c.state, `${c.ageDays}d`, c.lastActivity,
      ])
    );
    if (p.cases.length > 200) doc.paragraph(`Truncated — ${p.cases.length - 200} further cases not printed.`);
    return;
  }

  if (id === "ops") {
    doc.sectionHeader("OPS Plans — Pending Approval");
    if (p.opsPending.length) {
      doc.table(
        ["OPS ID", "Title", "Detective", "Risk"],
        [110, doc.W - 340, 130, 100],
        p.opsPending.map((o) => [o.id, o.title, o.detective, o.risk])
      );
    } else {
      doc.paragraph("No OPS plans awaiting approval.");
    }
    doc.sectionHeader("OPS Plans — Signed / Returned");
    if (p.opsSigned.length) {
      doc.table(
        ["OPS ID", "Title", "Status", "By"],
        [110, doc.W - 340, 90, 140],
        p.opsSigned.map((o) => [o.id, o.title, o.status, o.signedBy || "—"])
      );
    } else {
      doc.paragraph("No signed or returned OPS plans yet.");
    }
  }
}

/** Render a resolved payload to PDF bytes. */
export async function renderReportPdf(p: ReportPayload): Promise<Uint8Array> {
  const who = [p.supervisor.name, p.supervisor.badge && `Badge ${p.supervisor.badge}`, p.supervisor.unit]
    .filter(Boolean)
    .join("  ·  ");
  const sub =
    `${p.scope.label}  ·  ${p.filterLabel}  ·  Generated ${new Date(p.generatedAt).toLocaleString()}` +
    (who ? `  ·  ${who}` : "");
  const doc = new Doc(p.title, sub);
  await doc.init();

  for (const id of p.sections) renderSection(doc, id, p);

  if (p.caveats.length) {
    doc.sectionHeader("Notes on these figures");
    p.caveats.forEach((c) => doc.paragraph(c));
  }

  return doc.finalize();
}

/** Render a payload to a downloadable PDF blob (no download side-effect). */
export async function exportReportPdf(
  p: ReportPayload
): Promise<{ filename: string; blob: Blob }> {
  const bytes = await renderReportPdf(p);
  return {
    filename: reportFilename(p, "pdf"),
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
  };
}
