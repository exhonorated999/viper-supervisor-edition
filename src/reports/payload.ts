// ---------------------------------------------------------------------------
// ReportPayload — the single, already-resolved description of a report.
//
// The Reports page assembles ONE of these from live service data, then hands
// the same object to every renderer: the on-screen preview, the pdf-lib
// exporter (reports/generate.ts) and the interactive HTML exporter
// (reports/html.ts). Building it once means the preview cannot drift from the
// file the supervisor actually downloads — what you see is what you export.
//
// Everything in here is metadata only. Case narratives, evidence, media and
// note content never reach the supervisor in the first place (the investigator
// redacts at the source), so nothing sensitive can leak into an export.
// ---------------------------------------------------------------------------

import type {
  CaseBreakdownSlice,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
} from "../types";
import type { PeriodMetrics } from "../data/periods";
import { metricDef, formatMetricValue } from "../data/metrics";
import {
  ACTIVITY_LABELS,
  deriveActivitySeries,
  deriveActivityTotals,
  filterCasesByScope,
  type ActivityBucket,
  type ActivityTotals,
  type ResolvedScope,
} from "./scope";

export type ReportKind =
  | "unit"
  | "monthly"
  | "ytd"
  | "investigator"
  | "distribution"
  | "ops";

export interface ReportKindDef {
  kind: ReportKind;
  title: string;
  blurb: string;
  /** Sections this kind renders, in order. */
  sections: SectionId[];
}

export type SectionId =
  | "metrics"
  | "activity"
  | "trend"
  | "breakdown"
  | "workload"
  | "cases"
  | "ops";

export const REPORT_KINDS: ReportKindDef[] = [
  {
    kind: "unit",
    title: "Unit Briefing",
    blurb: "Everything on one document — metrics, activity, workload, cases and OPS plans.",
    sections: ["metrics", "activity", "trend", "breakdown", "workload", "cases", "ops"],
  },
  {
    kind: "monthly",
    title: "Monthly Summary",
    blurb: "Key metrics and case standing for the selected window.",
    sections: ["metrics", "activity", "breakdown"],
  },
  {
    kind: "ytd",
    title: "YTD Overview",
    blurb: "Year-to-date production with the month-by-month trend.",
    sections: ["metrics", "trend", "breakdown"],
  },
  {
    kind: "investigator",
    title: "Investigator Performance",
    blurb: "Per-investigator caseload, aging and activity.",
    sections: ["workload", "activity", "cases"],
  },
  {
    kind: "distribution",
    title: "Case Distribution",
    blurb: "How the unit's cases split by status, type and detective.",
    sections: ["breakdown", "cases"],
  },
  {
    kind: "ops",
    title: "OPS Plan Log",
    blurb: "Operations plans pending approval, signed and returned.",
    sections: ["ops"],
  },
];

export const KIND_BY_ID: Record<ReportKind, ReportKindDef> = Object.fromEntries(
  REPORT_KINDS.map((k) => [k.kind, k])
) as Record<ReportKind, ReportKindDef>;

/** One metric as it will be printed. */
export interface MetricRow {
  key: string;
  label: string;
  /** Formatted figure for the selected scope, or null when underivable. */
  value: string | null;
  /** Formatted lifetime figure, always available. */
  allTime: string;
  /** Why `value` is null, when it is. */
  note?: string;
}

export interface ReportFilters {
  /** Investigator names to include; empty = everyone. */
  investigators: string[];
  /** Case states to include; empty = all states. */
  states: string[];
}

export interface ReportPayload {
  kind: ReportKind;
  title: string;
  sections: SectionId[];
  generatedAt: string;
  supervisor: { name?: string; badge?: string; unit?: string };

  scope: {
    label: string;
    mode: "preset" | "custom";
    from: string | null;
    to: string | null;
    /** True when metric figures come straight from investigator buckets. */
    authoritative: boolean;
  };
  filters: ReportFilters;
  /** Human sentence describing any active filter, for the document header. */
  filterLabel: string;

  /** Caveats to print verbatim so a reader knows what the numbers mean. */
  caveats: string[];

  metrics: MetricRow[];
  activity: { key: string; label: string; value: number }[];
  series: ActivityBucket[];
  breakdown: CaseBreakdownSlice[];
  totalCases: number;
  workload: InvestigatorWorkload[];
  cases: CaseStatus[];
  opsPending: OpsPlan[];
  opsSigned: OpsPlan[];
}

export interface BuildPayloadInput {
  kind: ReportKind;
  scope: ResolvedScope;
  filters: ReportFilters;
  supervisor: { name?: string; badge?: string; unit?: string };
  periods: PeriodMetrics;
  metricKeys: string[];
  cases: CaseStatus[];
  workload: InvestigatorWorkload[];
  breakdown: CaseBreakdownSlice[];
  totalCases: number;
  opsPending: OpsPlan[];
  opsSigned: OpsPlan[];
}

function applyFilters(cases: CaseStatus[], f: ReportFilters): CaseStatus[] {
  return cases.filter((c) => {
    if (f.investigators.length && !f.investigators.includes(c.detective)) return false;
    if (f.states.length && !f.states.includes(c.state)) return false;
    return true;
  });
}

function describeFilters(f: ReportFilters): string {
  const parts: string[] = [];
  if (f.investigators.length) {
    parts.push(
      f.investigators.length <= 3
        ? f.investigators.join(", ")
        : `${f.investigators.length} investigators`
    );
  }
  if (f.states.length) parts.push(f.states.join(" / "));
  return parts.length ? parts.join("  ·  ") : "Entire unit";
}

/**
 * Metric rows for the selected scope.
 *
 * Preset scopes read the investigator-computed bucket. Custom ranges have no
 * bucket, so the figure is withheld (null) with a note — printing a lifetime
 * total under a "3 Mar – 11 Apr" heading would be a lie, and a zero would be
 * worse. The activity section carries the numbers we CAN stand behind for an
 * arbitrary window.
 */
function buildMetricRows(
  keys: string[],
  periods: PeriodMetrics,
  scope: ResolvedScope
): MetricRow[] {
  return keys.map((key) => {
    const label = metricDef(key).label;
    const at = periods.buckets.allTime[key];
    const allTime = formatMetricValue(key, at);

    if (scope.periodKey === "allTime") {
      return { key, label, value: allTime, allTime };
    }
    if (scope.mode === "custom") {
      return { key, label, value: null, allTime, note: "No bucket for custom ranges" };
    }
    if (!periods.hasPeriodData) {
      return { key, label, value: null, allTime, note: "Investigator has not pushed period data" };
    }
    const pv = scope.periodKey ? periods.buckets[scope.periodKey][key] : undefined;
    if (pv == null) {
      return { key, label, value: null, allTime, note: "Standing count — no period dimension" };
    }
    return { key, label, value: formatMetricValue(key, pv), allTime };
  });
}

function buildCaveats(scope: ResolvedScope, periods: PeriodMetrics): string[] {
  const out: string[] = [];
  if (scope.mode === "custom") {
    out.push(
      "Custom range: metric totals are derived locally from case activity events. " +
        "Standing counters (money seized, device tooling) have no date dimension and are omitted."
    );
  } else if (!periods.hasPeriodData && scope.periodKey !== "allTime") {
    out.push(
      "No investigator on this unit has pushed period buckets yet. Period figures are unavailable; " +
        "lifetime totals are shown alongside for reference."
    );
  }
  if (periods.staleSenders.length) {
    out.push(
      `Period figures exclude ${periods.staleSenders.length} investigator(s) running an older ` +
        `V.I.P.E.R. build: ${periods.staleSenders.join(", ")}.`
    );
  }
  out.push(
    "Metadata only. Case narratives, evidence, media and notes are never transmitted to " +
      "Supervisor Edition and cannot appear in this report."
  );
  return out;
}

/** Recompute the status breakdown over a filtered case set. */
function recomputeBreakdown(cases: CaseStatus[]): { slices: CaseBreakdownSlice[]; total: number } {
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.state, (counts.get(c.state) || 0) + 1);
  const total = cases.length;
  const slices = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => ({
      state: state as CaseBreakdownSlice["state"],
      count,
      pct: total ? Math.round((count / total) * 100) : 0,
    }));
  return { slices, total };
}

export function buildReportPayload(input: BuildPayloadInput): ReportPayload {
  const def = KIND_BY_ID[input.kind];
  const scoped = filterCasesByScope(input.cases, input.scope);
  const cases = applyFilters(scoped, input.filters);

  const totals: ActivityTotals = deriveActivityTotals(cases, input.scope);
  const activity = (Object.keys(ACTIVITY_LABELS) as (keyof ActivityTotals)[]).map((k) => ({
    key: k,
    label: ACTIVITY_LABELS[k],
    value: totals[k],
  }));

  // Filtering the case set changes the denominator, so the donut has to be
  // recomputed rather than reusing the dashboard's unit-wide slices.
  const filtered = input.filters.investigators.length || input.filters.states.length ||
    input.scope.from || input.scope.to;
  const bd = filtered
    ? recomputeBreakdown(cases)
    : { slices: input.breakdown, total: input.totalCases };

  const workload = input.filters.investigators.length
    ? input.workload.filter((w) => input.filters.investigators.includes(w.name))
    : input.workload;

  return {
    kind: input.kind,
    title: def.title,
    sections: def.sections,
    generatedAt: new Date().toISOString(),
    supervisor: input.supervisor,
    scope: {
      label: input.scope.label,
      mode: input.scope.mode,
      from: input.scope.from ? input.scope.from.toISOString() : null,
      to: input.scope.to ? input.scope.to.toISOString() : null,
      authoritative: input.scope.authoritative,
    },
    filters: input.filters,
    filterLabel: describeFilters(input.filters),
    caveats: buildCaveats(input.scope, input.periods),
    metrics: buildMetricRows(input.metricKeys, input.periods, input.scope),
    activity,
    series: deriveActivitySeries(cases, input.scope) as ActivityBucket[],
    breakdown: bd.slices,
    totalCases: bd.total,
    workload,
    cases,
    opsPending: input.opsPending,
    opsSigned: input.opsSigned,
  };
}

/** Filename stem shared by every export format. */
export function reportFilename(p: ReportPayload, ext: string): string {
  const slug = p.title.replace(/[^\w]+/g, "_");
  const date = p.generatedAt.slice(0, 10);
  return `VIPER_Supervisor_${slug}_${date}.${ext}`;
}
