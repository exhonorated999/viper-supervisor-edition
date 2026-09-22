// ---------------------------------------------------------------------------
// Smoke check for the Reports page pipeline.
//
//   npx tsx scripts/report-render-check.mts
//
// Builds a payload from synthetic unit data for every report kind and both
// scope modes, then renders it through the PDF and interactive-HTML exporters.
// Asserts the output is structurally sound and that the honesty rules hold
// (custom ranges withhold metric buckets; presets report them).
//
// Writes a sample HTML file to scripts/_report-sample.html so the interactive
// export can be eyeballed in a browser. The file is gitignored (scripts/_*).
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReportPayload, REPORT_KINDS, type ReportKind } from "../src/reports/payload";
import { defaultScope, resolveScope, toInputDate } from "../src/reports/scope";
import { renderReportHtml } from "../src/reports/html";
import {
  renderReportPdf,
  buildQuickReport,
  type ReportData as QuickReportData,
  type ReportKind as QuickKind,
} from "../src/reports/generate";
import { currentPeriodLabels, type PeriodMetrics } from "../src/data/periods";
import type { CaseStatus, InvestigatorWorkload, OpsPlan } from "../src/types";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

// --- synthetic unit --------------------------------------------------------

const now = new Date();
const dayAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

function mkCase(i: number, det: string, state: CaseStatus["state"], age: number): CaseStatus {
  return {
    caseNumber: `25-${String(1000 + i)}`,
    detective: det,
    state,
    caseType: "Burglary",
    description: "Redacted",
    openedDate: dayAgo(age),
    ageDays: age,
    lastActivity: "Search warrant served",
    lastActivityKind: "Warrant",
    lastActivityDate: dayAgo(Math.max(0, age - 3)),
    activity: {
      lastActivity: dayAgo(Math.max(0, age - 3)),
      totals: { total: 4, warrants: 2, warrantsServed: 1, evidence: 1, reports: 1, fieldwork: 1 },
      cadence: [],
      events: [
        { date: dayAgo(age), lane: "incident", category: "custom", action: "Case Opened", significance: "major" },
        { date: dayAgo(Math.max(0, age - 2)), lane: "investigation", category: "warrant", action: "Search warrant signed", significance: "major" },
        { date: dayAgo(Math.max(0, age - 3)), lane: "investigation", category: "warrant", action: "Search warrant served", significance: "major" },
        { date: dayAgo(Math.max(0, age - 4)), lane: "forensics", category: "digital", action: "Evidence logged", significance: "supporting" },
        ...(state === "Closed"
          ? [{ date: dayAgo(1), lane: "investigation" as const, category: "custom", action: "Case Closed", significance: "major" as const }]
          : []),
      ],
    },
  };
}

const cases: CaseStatus[] = [
  mkCase(1, "Det. Alvarez", "Open", 4),
  mkCase(2, "Det. Alvarez", "Ongoing", 20),
  mkCase(3, "Det. Boone", "Closed", 9),
  mkCase(4, "Det. Boone", "Transferred", 75),
  mkCase(5, "Det. Chen", "Open", 120),
];

const workload: InvestigatorWorkload[] = [
  { id: "1", name: "Det. Alvarez", initials: "DA", total: 2, open: 1, ongoing: 1, aging: 0, newMtd: 1, band: "Balanced" },
  { id: "2", name: "Det. Boone", initials: "DB", total: 2, open: 0, ongoing: 0, aging: 1, newMtd: 0, band: "Light" },
  { id: "3", name: "Det. Chen", initials: "DC", total: 1, open: 1, ongoing: 0, aging: 1, newMtd: 0, band: "High" },
];

const opsPending: OpsPlan[] = [
  { id: "OPS-2026-0004", title: "Warrant service — </script> injection probe", detective: "Det. Boone", submittedDate: dayAgo(2), risk: "High Risk", status: "Pending", summary: "Redacted" },
];
const opsSigned: OpsPlan[] = [
  { id: "OPS-2026-0003", title: "Surveillance detail", detective: "Det. Chen", submittedDate: dayAgo(12), risk: "Low Risk", status: "Signed", summary: "Redacted", signedBy: "Sgt. Reyes", signedAt: dayAgo(11), pdfBase64: "A".repeat(200000) },
];

const labels = currentPeriodLabels();
const periods: PeriodMetrics = {
  buckets: {
    month: { arrests: 3, new_cases_assigned: 2, cases_closed: 1 },
    quarter: { arrests: 9, new_cases_assigned: 7, cases_closed: 4 },
    year: { arrests: 22, new_cases_assigned: 31, cases_closed: 18 },
    allTime: { arrests: 57, new_cases_assigned: 104, cases_closed: 66, money_seized: 41500 },
  },
  labels,
  hasPeriodData: true,
  staleSenders: [],
};

const metricKeys = ["arrests", "new_cases_assigned", "cases_closed", "money_seized"];

const common = {
  supervisor: { name: "Sgt. Reyes", badge: "4417", unit: "Investigations" },
  periods,
  metricKeys,
  cases,
  workload,
  breakdown: [
    { state: "Open" as const, count: 2, pct: 40 },
    { state: "Ongoing" as const, count: 1, pct: 20 },
    { state: "Closed" as const, count: 1, pct: 20 },
    { state: "Transferred" as const, count: 1, pct: 20 },
  ],
  totalCases: 5,
  opsPending,
  opsSigned,
};

const noFilters = { investigators: [], states: [] };

// --- 1. every kind renders both formats ------------------------------------

console.log("\nEvery report kind renders to PDF and HTML");
const presetScope = resolveScope({ ...defaultScope(), mode: "preset", preset: "month" }, labels);

for (const def of REPORT_KINDS) {
  const p = buildReportPayload({ kind: def.kind as ReportKind, scope: presetScope, filters: noFilters, ...common });
  const html = renderReportHtml(p);
  const pdf = await renderReportPdf(p);
  ok(
    `${def.title}: html ${Math.round(html.length / 1024)}kB, pdf ${Math.round(pdf.length / 1024)}kB`,
    html.toLowerCase().startsWith("<!doctype html") && html.trimEnd().endsWith("</html>") && pdf.length > 1000
  );
  // Written out so scripts/pdf-layout-check.py can assert no text overlaps.
  writeFileSync(resolve(process.cwd(), `scripts/_report-${def.kind}.pdf`), pdf);
}

// The legacy Quick Reports path (Dashboard tiles) shares the same layout
// engine, so it gets sampled too — that is where the overlapping labels were
// first spotted.
{
  const quick: QuickReportData = {
    supervisor: { name: "B. Guith", badge: "654", unit: "Investigations" },
    metricValues: { arrests: 0, money_seized: 0, cases_closed: 0, new_cases_assigned: 0, closed_w_arrest: 0 },
    periods,
    cardKeys: ["arrests", "money_seized", "cases_closed", "new_cases_assigned", "closed_w_arrest"],
    quickKeys: ["open_cases", "cases_closed", "arrests", "narcotics_seized"],
    breakdown: common.breakdown,
    totalCases: 11,
    workload,
    cases,
    opsPending,
    opsSigned,
  };
  for (const k of ["monthly", "ytd", "investigator", "distribution", "ops"] as QuickKind[]) {
    const bytes = await buildQuickReport(k, quick);
    ok(`quick report "${k}" renders`, bytes.length > 1000);
    writeFileSync(resolve(process.cwd(), `scripts/_quick-${k}.pdf`), bytes);
  }
}

// --- 2. honesty rules -------------------------------------------------------

console.log("\nMetric figures are withheld when they cannot be stood behind");
const monthly = buildReportPayload({ kind: "monthly", scope: presetScope, filters: noFilters, ...common });
ok("preset month reports the month bucket", monthly.metrics.find((m) => m.key === "arrests")?.value === "3");
ok(
  "standing counter with no month bucket is withheld, not zeroed",
  monthly.metrics.find((m) => m.key === "money_seized")?.value === null
);

const custom = resolveScope(
  { mode: "custom", preset: "month", start: toInputDate(new Date(now.getTime() - 30 * 86400000)), end: toInputDate(now) },
  labels
);
const customPayload = buildReportPayload({ kind: "unit", scope: custom, filters: noFilters, ...common });
ok("custom range withholds every metric bucket", customPayload.metrics.every((m) => m.value === null));
ok("custom range carries a caveat", customPayload.caveats.length > 0);
ok("custom range still derives activity", customPayload.activity.some((a) => a.value > 0));
ok("custom range label names the dates", /\d{4}/.test(customPayload.scope.label) && customPayload.scope.label.includes("–"));

// --- 3. filters -------------------------------------------------------------

console.log("\nFilters narrow the case set and the denominators");
const filtered = buildReportPayload({
  kind: "unit",
  scope: resolveScope({ ...defaultScope(), preset: "allTime" }, labels),
  filters: { investigators: ["Det. Alvarez"], states: [] },
  ...common,
});
ok("only the selected investigator's cases survive", filtered.cases.every((c) => c.detective === "Det. Alvarez"));
ok("workload is narrowed too", filtered.workload.length === 1);
ok("breakdown is recomputed against the filtered set", filtered.totalCases === filtered.cases.length);
ok("filter label names the investigator", filtered.filterLabel.includes("Alvarez"));

const stateFiltered = buildReportPayload({
  kind: "distribution",
  scope: resolveScope({ ...defaultScope(), preset: "allTime" }, labels),
  filters: { investigators: [], states: ["Open"] },
  ...common,
});
ok("state filter applies", stateFiltered.cases.every((c) => c.state === "Open"));

// --- 4. HTML export safety --------------------------------------------------

console.log("\nInteractive HTML export is self-contained and injection-safe");
const unit = buildReportPayload({ kind: "unit", scope: presetScope, filters: noFilters, ...common });
const html = renderReportHtml(unit);
const scriptOpens = (html.match(/<script/g) || []).length;
const scriptCloses = (html.match(/<\/script>/g) || []).length;
ok(`script tags balanced (${scriptOpens}/${scriptCloses})`, scriptOpens === scriptCloses);
ok("no remote references", !/https?:\/\/(?!www\.w3\.org)/.test(html));
ok("the raw </script> in an OPS title did not break out", !html.includes("</script> injection"));
ok("the OPS title still round-trips escaped", html.includes("injection probe"));
ok(
  "the 200kB OPS pdf attachment was stripped",
  !html.includes("A".repeat(500)) && html.length < 400_000,
  `${Math.round(html.length / 1024)}kB`
);

const out = resolve(process.cwd(), "scripts/_report-sample.html");
writeFileSync(out, html, "utf8");
console.log(`\nSample written to ${out}`);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
