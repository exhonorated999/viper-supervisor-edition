// ---------------------------------------------------------------------------
// Delivery → Dashboard transforms.
//
// Investigator devices push compact snapshots whose shape is convenient for
// the *sender* (headline rows, byStatus counts, digest rows). The supervisor
// Dashboard renders a different, richer shape (Stats / CaseStatus). The LAN
// node is a pure router and does NOT reshape payloads, so the mapping lives
// here — the one seam that knows both contracts.
//
// Pushed stats body (from VIPER supervisor-link-ui buildStatsSnapshot):
//   { headline:[{label,value}], byStatus:[{label,count}], byType:[...],
//     investigator, badge }
// Pushed caseStatus body (buildCaseDigest):
//   { rows:[{caseNumber,label,state,risk,lastActivity,assignee}] }
// ---------------------------------------------------------------------------

import type {
  Stats,
  CaseStatus,
  CaseState,
  Metric,
  MetricKey,
  CaseBreakdownSlice,
} from "../types";

/** Normalise an investigator status label to a dashboard CaseState. */
function toCaseState(raw: unknown): CaseState {
  const s = String(raw || "").toLowerCase();
  if (/transfer/.test(s)) return "Transferred";
  if (/clos|clear|arrest|adjud|inactiv/.test(s)) return "Closed";
  if (/ongoing|progress|pending|review/.test(s)) return "Ongoing";
  if (/open|active|new/.test(s)) return "Open";
  return "Ongoing";
}

/** Pull a numeric value out of a headline row whose value may be "12" or "$1,200" or "48%". */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Look up a headline row by case-insensitive label substring. */
function headlineVal(
  headline: Array<{ label: string; value: unknown }>,
  match: RegExp
): { value: unknown } | undefined {
  return headline.find((h) => match.test(String(h.label || "")));
}

/**
 * Map a pushed stats snapshot body into the Dashboard's Stats shape.
 * Only the metric cards the snapshot actually carries are emitted (Open /
 * Closed); the rest of the dashboard's cards need data the snapshot doesn't
 * include. The donut breakdown is derived from byStatus.
 */
export function deriveStatsFromDelivery(body: any): Stats {
  const headline: Array<{ label: string; value: unknown }> = Array.isArray(
    body?.headline
  )
    ? body.headline
    : [];
  const byStatus: Array<{ label: string; count: number }> = Array.isArray(
    body?.byStatus
  )
    ? body.byStatus
    : [];

  const total = num(headlineVal(headline, /total/i)?.value);
  const open = num(headlineVal(headline, /^open|\bopen\b/i)?.value);
  const closed = num(headlineVal(headline, /clos/i)?.value);

  const metrics: Metric[] = [];
  const card = (
    key: MetricKey,
    label: string,
    value: string | number
  ): Metric => ({
    key,
    label,
    value: String(value),
    delta: "—",
    deltaDirection: "up",
    comparison: "live snapshot",
    scope: "MTD",
  });
  metrics.push(card("casesOpened", "Cases Open", open));
  metrics.push(card("casesClosed", "Cases Closed", closed));

  // Roll byStatus into the four dashboard buckets so the donut colours match.
  const buckets: Record<CaseState, number> = {
    Open: 0,
    Ongoing: 0,
    Closed: 0,
    Transferred: 0,
  };
  byStatus.forEach((r) => {
    buckets[toCaseState(r.label)] += num(r.count);
  });
  const bucketTotal =
    buckets.Open + buckets.Ongoing + buckets.Closed + buckets.Transferred;
  const totalCases = total || bucketTotal;

  const breakdown: CaseBreakdownSlice[] = (
    Object.keys(buckets) as CaseState[]
  )
    .filter((state) => buckets[state] > 0)
    .map((state) => ({
      state,
      count: buckets[state],
      pct: bucketTotal ? Math.round((buckets[state] / bucketTotal) * 100) : 0,
    }));

  // Snapshot carries no time series, so the trend graph stays empty.
  return {
    metrics,
    trend: [],
    totalCases,
    breakdown,
  };
}

/** Map a pushed case-status digest body into CaseStatus rows. */
export function deriveCasesFromDigest(body: any): CaseStatus[] {
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  return rows.map((r) => {
    const lastActivityDate = String(r.lastActivity || "").slice(0, 10);
    return {
      caseNumber: String(r.caseNumber || "—"),
      detective: String(r.assignee || "—"),
      state: toCaseState(r.state),
      caseType: String(r.risk || "—"),
      description: String(r.label || ""),
      openedDate: lastActivityDate,
      ageDays: 0,
      lastActivity: String(r.state || "Updated"),
      lastActivityKind: "New Case",
      lastActivityDate,
    };
  });
}
