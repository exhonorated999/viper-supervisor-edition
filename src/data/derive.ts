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
  InvestigatorWorkload,
  OpsPlan,
  RiskLevel,
  TrendPoint,
} from "../types";

/** Normalise an arbitrary risk/priority label to a dashboard RiskLevel. */
function toRiskLevel(raw: unknown): RiskLevel {
  const s = String(raw || "").toLowerCase();
  if (/high|critical|severe|1|priority/.test(s)) return "High Risk";
  if (/low|routine|3/.test(s)) return "Low Risk";
  return "Medium Risk";
}

/** Normalise an investigator status label to a dashboard CaseState. */
function toCaseState(raw: unknown): CaseState {
  const s = String(raw || "").toLowerCase();
  if (/transfer/.test(s)) return "Transferred";
  if (/clos|clear|arrest|adjud|inactiv/.test(s)) return "Closed";
  if (/ongoing|progress|pending|review/.test(s)) return "Ongoing";
  if (/open|active|new/.test(s)) return "Open";
  return "Ongoing";
}

/** Two-letter avatar initials from a display name. */
function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    const activity = r.activity && typeof r.activity === "object" ? r.activity : undefined;
    const latest = activity?.events?.[0];
    const lastActivityDate = String(
      activity?.lastActivity || r.lastActivity || ""
    ).slice(0, 10);
    const isArrest = /arrest/i.test(String(r.state || ""));
    return {
      caseNumber: String(r.caseNumber || "—"),
      detective: String(r.assignee || "—"),
      state: toCaseState(r.state),
      caseType: String(r.risk || "—"),
      description: String(r.label || ""),
      openedDate: lastActivityDate,
      ageDays: 0,
      lastActivity: latest ? String(latest.action) : String(r.state || "Updated"),
      lastActivityKind: isArrest ? "Arrest" : "New Case",
      lastActivityDate,
      activity,
    };
  });
}

/**
 * Map a pushed opsPlan delivery into the Dashboard's OpsPlan shape.
 *
 * The investigator sends a manifest ({ title, caseNumber, risk, date,
 * location }) plus a one-page PDF body. The supervisor's review status lives
 * on the delivery itself: status "approved" → Signed, "returned" → Returned,
 * everything else → Pending. The signature / return decision (if any) is
 * carried in delivery.decision.
 */
export function deriveOpsPlanFromDelivery(delivery: any): OpsPlan {
  const m = delivery?.manifest || {};
  const status: OpsPlan["status"] =
    delivery?.status === "approved"
      ? "Signed"
      : delivery?.status === "returned"
      ? "Returned"
      : "Pending";

  const summaryBits = [
    m.caseNumber ? `Case ${m.caseNumber}` : null,
    m.date || null,
    m.location || null,
  ].filter(Boolean);

  const plan: OpsPlan = {
    id: String(delivery?.id || m.caseNumber || "OPS"),
    title: String(m.title || "Operations Plan"),
    detective: String(delivery?.from || "Investigator"),
    submittedDate: String(delivery?.sentAt || new Date().toISOString()),
    risk: toRiskLevel(m.risk),
    status,
    summary: summaryBits.join(" · ") || "One-page OPS plan submitted for approval.",
  };

  const dec = delivery?.decision;
  if (dec) {
    plan.signedBy = dec.by;
    plan.signedAt = dec.at;
    plan.comments = dec.comments;
  }
  // Carry the attached one-page PDF through so the review modal can open it.
  if (delivery?.body?.pdfBase64) {
    plan.fileName = delivery.body.fileName || "operations-plan.pdf";
    plan.pdfBase64 = delivery.body.pdfBase64;
  }
  return plan;
}

/**
 * Aggregate a pushed case-status digest into per-investigator workload rows.
 * Cases are grouped by assignee; open/ongoing/aging counts are derived from
 * each row's state and last-activity date. The snapshot carries no creation
 * dates, so "new this month" is reported as 0.
 */
export function deriveWorkloadFromDigest(body: any): InvestigatorWorkload[] {
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  type Agg = { total: number; open: number; ongoing: number; aging: number };
  const byInv = new Map<string, Agg>();

  rows.forEach((r) => {
    const name = String(r.assignee || "Investigator").trim() || "Investigator";
    const g = byInv.get(name) || { total: 0, open: 0, ongoing: 0, aging: 0 };
    const state = toCaseState(r.state);
    g.total += 1;
    if (state !== "Closed" && state !== "Transferred") g.open += 1;
    if (state === "Ongoing") g.ongoing += 1;
    const t = Date.parse(String(r.lastActivity || ""));
    if (!Number.isNaN(t) && (Date.now() - t) / 86_400_000 > 60) g.aging += 1;
    byInv.set(name, g);
  });

  return [...byInv.entries()]
    .map(([name, g]) => ({
      id: "inv-" + name.replace(/\s+/g, "-").toLowerCase(),
      name,
      initials: initials(name),
      total: g.total,
      open: g.open,
      ongoing: g.ongoing,
      aging: g.aging,
      newMtd: 0,
      band: (g.total >= 12 ? "High" : g.total >= 5 ? "Balanced" : "Light") as
        | "High"
        | "Balanced"
        | "Light",
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Synthesize the Unit Overview trend (Cases Opened / Closed / Arrests) from
 * the per-case data the digest now carries. The pushed *stats* snapshot has no
 * time series, but the *case-status* digest does (real createdAt via the
 * "Case opened" activity event, plus closed/transferred + arrest dates).
 *
 * The `range` controls the window + bucket granularity:
 *   - "month"   → weekly buckets within the current calendar month
 *   - "quarter" → weekly buckets across the last ~13 weeks
 *   - "year"    → monthly buckets across the last 12 months
 */
export type TrendRange = "month" | "quarter" | "year";

function _startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}

export function deriveTrendFromCases(
  cases: CaseStatus[],
  range: TrendRange = "month"
): TrendPoint[] {
  const now = new Date();
  let windowStart: Date;
  let granularity: "week" | "month";
  if (range === "year") {
    windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    granularity = "month";
  } else if (range === "quarter") {
    windowStart = new Date(now);
    windowStart.setDate(now.getDate() - 91);
    granularity = "week";
  } else {
    windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
    granularity = "week";
  }

  // Collect (date, series) contributions from each case.
  const pts: { date: string; series: "casesOpened" | "casesClosed" | "arrests" }[] = [];
  cases.forEach((c) => {
    const openedEv = c.activity?.events?.find((e) => /case opened/i.test(e.action));
    pts.push({ date: openedEv?.date || c.openedDate, series: "casesOpened" });
    if (c.state === "Closed" || c.state === "Transferred")
      pts.push({ date: c.lastActivityDate, series: "casesClosed" });
    if (c.lastActivityKind === "Arrest")
      pts.push({ date: c.lastActivityDate, series: "arrests" });
  });

  type Bucket = {
    label: string;
    sortKey: string;
    casesOpened: number;
    casesClosed: number;
    arrests: number;
  };
  const buckets = new Map<string, Bucket>();
  pts.forEach(({ date, series }) => {
    const d = new Date(date);
    if (isNaN(+d) || d < windowStart) return;
    let key: string;
    let label: string;
    if (granularity === "month") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString(undefined, {
        month: "short",
      });
    } else {
      const ws = _startOfWeek(d);
      key = ws.toISOString().slice(0, 10);
      label = ws.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    let b = buckets.get(key);
    if (!b) {
      b = { label, sortKey: key, casesOpened: 0, casesClosed: 0, arrests: 0 };
      buckets.set(key, b);
    }
    b[series]++;
  });

  return [...buckets.values()]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ label, casesOpened, casesClosed, arrests }) => ({
      label,
      casesOpened,
      casesClosed,
      arrests,
    }));
}
