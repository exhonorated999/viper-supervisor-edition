// Verify period-bucketed metric aggregation against the exact wire shape the
// investigator app now pushes (VIPER index.html window.viperMetricsByPeriod +
// supervisor-link-ui buildStatsSnapshot).
// Run: npx tsx scripts/period-stats-check.mts
import assert from "node:assert/strict";
import { aggregateMetricPeriods } from "../src/data/derive.ts";
import { currentPeriodLabels, periodTag } from "../src/data/periods.ts";

let pass = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};

/** One stats delivery, period-aware sender (new VIPER build). */
function modern(from: string, sentAt: string, b: Record<string, Record<string, number>>) {
  return {
    id: "d-" + from + sentAt,
    dtype: "stats",
    from,
    fromDeviceId: "dev-" + from,
    sentAt,
    body: {
      headline: [
        { label: "Total Cases", value: 10 },
        { label: "Open", value: 7 },
        { label: "Closed", value: 3 },
      ],
      byStatus: [{ label: "Transferred", count: 1 }],
      metrics: b.allTime,
      metricsByPeriod: {
        buckets: b,
        periods: {
          month: { label: "September 2026", start: "2026-09-01T07:00:00.000Z", end: "2026-10-01T07:00:00.000Z" },
          quarter: { label: "Q3 2026", start: "2026-07-01T07:00:00.000Z", end: "2026-10-01T07:00:00.000Z" },
          year: { label: "2026", start: "2026-01-01T08:00:00.000Z", end: "2027-01-01T08:00:00.000Z" },
        },
        generatedAt: sentAt,
      },
      investigator: from,
      badge: "100",
    },
  };
}

/** A sender still running a pre-period VIPER build: flat `metrics` only. */
function legacy(from: string, sentAt: string, metrics: Record<string, number>) {
  return {
    id: "l-" + from,
    dtype: "stats",
    from,
    fromDeviceId: "dev-" + from,
    sentAt,
    body: {
      headline: [
        { label: "Total Cases", value: 4 },
        { label: "Open", value: 4 },
        { label: "Closed", value: 0 },
      ],
      byStatus: [],
      metrics,
      investigator: from,
    },
  };
}

console.log("period-stats-check");

// --- 1. two modern investigators sum per bucket ---------------------------
ok("sums every bucket across investigators", () => {
  const r = aggregateMetricPeriods([
    modern("A. Rivera", "2026-09-21T10:00:00Z", {
      allTime: { arrests: 10, cases_closed: 8, open_cases: 5 },
      month: { arrests: 2, cases_closed: 1, open_cases: 5 },
      quarter: { arrests: 4, cases_closed: 3, open_cases: 5 },
      year: { arrests: 9, cases_closed: 7, open_cases: 5 },
    }),
    modern("J. Moyer", "2026-09-21T10:05:00Z", {
      allTime: { arrests: 6, cases_closed: 4, open_cases: 11 },
      month: { arrests: 1, cases_closed: 2, open_cases: 11 },
      quarter: { arrests: 3, cases_closed: 2, open_cases: 11 },
      year: { arrests: 5, cases_closed: 4, open_cases: 11 },
    }),
  ]);
  assert.equal(r.hasPeriodData, true);
  assert.deepEqual(r.staleSenders, []);
  assert.equal(r.buckets.month.arrests, 3);
  assert.equal(r.buckets.quarter.arrests, 7);
  assert.equal(r.buckets.year.arrests, 14);
  assert.equal(r.buckets.allTime.arrests, 16);
  assert.equal(r.buckets.month.cases_closed, 3);
  assert.equal(r.buckets.allTime.open_cases, 16);
  // Wire labels win over locally computed ones.
  assert.equal(r.labels.month, "September 2026");
  assert.equal(r.labels.quarter, "Q3 2026");
  assert.equal(r.labels.year, "2026");
});

// --- 2. only the LATEST snapshot per sender counts ------------------------
ok("keeps only the newest snapshot per sender (no double counting)", () => {
  const r = aggregateMetricPeriods([
    modern("A. Rivera", "2026-09-01T08:00:00Z", {
      allTime: { arrests: 100 },
      month: { arrests: 100 },
      quarter: { arrests: 100 },
      year: { arrests: 100 },
    }),
    modern("A. Rivera", "2026-09-21T08:00:00Z", {
      allTime: { arrests: 7 },
      month: { arrests: 2 },
      quarter: { arrests: 5 },
      year: { arrests: 7 },
    }),
  ]);
  assert.equal(r.buckets.month.arrests, 2, "stale 100 must not be summed in");
  assert.equal(r.buckets.allTime.arrests, 7);
});

// --- 3. metrics with no period dimension stay ABSENT, not zero -----------
ok("omits period-less metrics so the UI can show an em dash", () => {
  const r = aggregateMetricPeriods([
    modern("A. Rivera", "2026-09-21T10:00:00Z", {
      // VIPER drops keys whose `monthly` is null (standing counts).
      allTime: { arrests: 3, missing_persons: 2 },
      month: { arrests: 1 },
      quarter: { arrests: 2 },
      year: { arrests: 3 },
    }),
  ]);
  assert.equal(r.buckets.allTime.missing_persons, 2);
  assert.equal(r.buckets.month.missing_persons, undefined, "must be absent, not 0");
  assert.equal(r.buckets.month.arrests, 1);
});

// --- 4. legacy sender degrades gracefully --------------------------------
ok("legacy sender contributes all-time only and is flagged", () => {
  const r = aggregateMetricPeriods([
    modern("A. Rivera", "2026-09-21T10:00:00Z", {
      allTime: { arrests: 5 },
      month: { arrests: 2 },
      quarter: { arrests: 3 },
      year: { arrests: 5 },
    }),
    legacy("B. Old", "2026-09-20T10:00:00Z", { arrests: 4 }),
  ]);
  assert.equal(r.hasPeriodData, true, "one modern sender is enough to enable periods");
  assert.deepEqual(r.staleSenders, ["B. Old"]);
  assert.equal(r.buckets.allTime.arrests, 9, "all-time includes the legacy sender");
  assert.equal(r.buckets.month.arrests, 2, "period excludes the legacy sender");
});

ok("all-legacy unit reports hasPeriodData=false", () => {
  const r = aggregateMetricPeriods([legacy("B. Old", "2026-09-20T10:00:00Z", { arrests: 4 })]);
  assert.equal(r.hasPeriodData, false);
  assert.equal(r.buckets.allTime.arrests, 4);
  // headline backfill still works for old senders
  assert.equal(r.buckets.allTime.open_cases, 4);
});

// --- 5. empty / malformed input ------------------------------------------
ok("empty and malformed inboxes never throw", () => {
  for (const input of [[], null as any, undefined as any, [{ dtype: "caseStatus", body: {} }], [{}]]) {
    const r = aggregateMetricPeriods(input as any[]);
    assert.equal(r.hasPeriodData, false);
    assert.equal(typeof r.buckets.month, "object");
  }
});

ok("currency strings on the wire coerce to numbers", () => {
  const d = modern("A. Rivera", "2026-09-21T10:00:00Z", {
    allTime: {}, month: {}, quarter: {}, year: {},
  });
  (d.body.metricsByPeriod.buckets as any).month = { money_seized: "$12,500" as any };
  const r = aggregateMetricPeriods([d]);
  assert.equal(r.buckets.month.money_seized, 12500);
});

// --- 6. label tags --------------------------------------------------------
ok("period tags render compactly", () => {
  const labels = { month: "September 2026", quarter: "Q3 2026", year: "2026", allTime: "All time" };
  assert.equal(periodTag("month", labels), "SEP MTD");
  assert.equal(periodTag("quarter", labels), "Q3 QTD");
  assert.equal(periodTag("year", labels), "YTD 2026");
  assert.equal(periodTag("allTime", labels), "ALL TIME");
});

ok("locally computed labels match the calendar", () => {
  const l = currentPeriodLabels(new Date(2026, 8, 21)); // 21 Sep 2026
  assert.equal(l.quarter, "Q3 2026");
  assert.equal(l.year, "2026");
  assert.match(l.month, /2026$/);
  const l2 = currentPeriodLabels(new Date(2026, 0, 5)); // 5 Jan 2026
  assert.equal(l2.quarter, "Q1 2026");
});

console.log(`\n${pass}/${pass} period-stats checks passed`);
