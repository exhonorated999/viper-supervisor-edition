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

const CYAN = rgb(0.0, 0.717, 0.764);
const INK = rgb(0.11, 0.13, 0.16);
const DIM = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.85, 0.87, 0.9);
const BAND = rgb(0.1, 0.12, 0.15);

export type ReportKind = "monthly" | "ytd" | "investigator" | "distribution" | "ops";

export interface ReportData {
  supervisor: { name?: string; badge?: string; unit?: string };
  metricValues: Record<string, number>;
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
      this.text(this.subtitle, this.M, this.y - 6, { color: DIM, size: 9 });
      this.y -= 22;
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
    this.page.drawText(s, { x, y: yy, size: o.size ?? 10, font: o.font ?? this.font, color: o.color ?? INK });
  }

  sectionHeader(label: string) {
    this.ensure(30);
    this.y -= 6;
    this.page.drawRectangle({ x: this.M, y: this.y - 16, width: this.W, height: 20, color: BAND });
    this.text(label, this.M + 8, this.y - 11, { font: this.bold, size: 10, color: CYAN });
    this.y -= 30;
  }

  keyValueGrid(rows: { label: string; value: string }[]) {
    const colW = this.W / 2;
    const rowH = 26;
    rows.forEach((r, i) => {
      const col = i % 2;
      if (col === 0) this.ensure(rowH);
      const x = this.M + col * colW;
      const yTop = this.y;
      this.page.drawRectangle({ x, y: yTop - rowH + 4, width: colW - 8, height: rowH - 4, borderColor: LINE, borderWidth: 1, color: rgb(0.98, 0.98, 0.99) });
      this.text(r.value, x + 10, yTop - 15, { font: this.bold, size: 14, color: INK });
      this.text(r.label.toUpperCase(), x + 10, yTop - rowH + 9, { size: 6.5, color: DIM });
      if (col === 1 || i === rows.length - 1) this.y -= rowH + 6;
    });
  }

  table(headers: string[], widths: number[], rows: string[][]) {
    const rowH = 18;
    const drawHead = () => {
      this.ensure(rowH * 2);
      let x = this.M;
      this.page.drawRectangle({ x: this.M, y: this.y - rowH + 4, width: this.W, height: rowH, color: BAND });
      headers.forEach((h, i) => {
        this.text(h, x + 4, this.y - 9, { font: this.bold, size: 8, color: CYAN });
        x += widths[i];
      });
      this.y -= rowH;
    };
    drawHead();
    rows.forEach((r) => {
      this.ensure(rowH);
      if (this.y === 792 - this.M - 8) drawHead();
      let x = this.M;
      r.forEach((c, i) => {
        this.text(this.clip(c, widths[i]), x + 4, this.y - 9, { size: 8, color: INK });
        x += widths[i];
      });
      this.page.drawLine({ start: { x: this.M, y: this.y - rowH + 3 }, end: { x: this.M + this.W, y: this.y - rowH + 3 }, thickness: 0.5, color: LINE });
      this.y -= rowH;
    });
    this.y -= 6;
  }

  clip(s: string, w: number): string {
    const max = Math.max(4, Math.floor(w / 4.6));
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  paragraph(s: string) {
    this.ensure(16);
    this.text(s, this.M, this.y - 10, { size: 9, color: DIM });
    this.y -= 16;
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

function metricRows(d: ReportData, keys: string[]): { label: string; value: string }[] {
  return keys.map((k) => ({
    label: metricDef(k).label,
    value: formatMetricValue(k, d.metricValues[k] ?? 0),
  }));
}

async function build(kind: ReportKind, d: ReportData): Promise<Uint8Array> {
  const meta = REPORT_META[kind];
  const who = [d.supervisor.name, d.supervisor.badge && `Badge ${d.supervisor.badge}`, d.supervisor.unit]
    .filter(Boolean)
    .join("  ·  ");
  const sub = `${meta.period}  ·  Generated ${new Date().toLocaleString()}${who ? "  ·  " + who : ""}`;
  const doc = new Doc(meta.title, sub);
  await doc.init();

  if (kind === "monthly" || kind === "ytd") {
    doc.sectionHeader("Key Metrics");
    doc.keyValueGrid(metricRows(d, d.cardKeys.length ? d.cardKeys : d.quickKeys));
    doc.sectionHeader("Quick Stats");
    doc.keyValueGrid(metricRows(d, d.quickKeys));
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
