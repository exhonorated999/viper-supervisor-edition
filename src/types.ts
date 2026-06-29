// ---------------------------------------------------------------------------
// V.I.P.E.R. Supervisor Edition — shared data contracts
//
// These types ARE the integration seam. Today they are populated by the mock
// service (src/data/service.ts). Later, the same shapes will be the payloads
// exchanged over the LAN handshake with investigator V.I.P.E.R. devices:
//   - Stats        -> unit-level metrics (top row + YTD + trend series)
//   - CaseStatus[] -> read-only case records mirrored from investigators
//   - OpsPlan[]    -> OPS plans for supervisor review / digital sign-off
// Nothing in the UI should depend on the data SOURCE — only on these shapes.
// ---------------------------------------------------------------------------

export type RiskLevel = "High Risk" | "Medium Risk" | "Low Risk";

export type WorkloadBand = "High" | "Balanced" | "Light";

export type CaseState = "Open" | "Ongoing" | "Closed" | "Transferred";

export type MetricKey =
  | "casesOpened"
  | "casesClosed"
  | "arrests"
  | "warrantsAuthored"
  | "moneyRecovered"
  | "gunsRecovered"
  | "transfers";

/** Top-row metric card descriptor. */
export interface Metric {
  key: MetricKey;
  label: string;
  /** Pre-formatted display value, e.g. "48" or "$128,450". */
  value: string;
  /** Signed delta vs comparison period, e.g. "12%". */
  delta: string;
  deltaDirection: "up" | "down";
  /** "vs last month" | "vs last year" */
  comparison: string;
  scope: "MTD" | "YTD";
}

/** One point in the unit activity trend graph. */
export interface TrendPoint {
  label: string; // e.g. "Apr 1"
  casesOpened: number;
  casesClosed: number;
  arrests: number;
}

/** Case status breakdown slice (donut). */
export interface CaseBreakdownSlice {
  state: CaseState;
  count: number;
  pct: number;
}

/** Unit-level statistics payload. */
export interface Stats {
  metrics: Metric[];
  trend: TrendPoint[];
  totalCases: number;
  breakdown: CaseBreakdownSlice[];
}

/** Read-only case record mirrored from an investigator device. */
export interface CaseStatus {
  caseNumber: string;
  detective: string;
  state: CaseState;
  caseType: string;
  description: string;
  openedDate: string; // ISO date
  ageDays: number;
  lastActivity: string; // human label, e.g. "Arrest Made"
  lastActivityKind: "Arrest" | "Warrant" | "Evidence" | "Closed" | "New Case";
  lastActivityDate: string; // ISO date
}

/** Aggregated workload row for one investigator. */
export interface InvestigatorWorkload {
  id: string;
  name: string;
  initials: string;
  total: number;
  open: number;
  ongoing: number;
  aging: number; // > 60 days
  newMtd: number;
  band: WorkloadBand;
}

/** OPS Plan awaiting / completed supervisor sign-off. */
export interface OpsPlan {
  id: string; // e.g. "OPS-2025-0417"
  title: string;
  detective: string;
  submittedDate: string; // ISO date
  risk: RiskLevel;
  status: "Pending" | "Signed" | "Returned";
  summary: string;
  // Populated once signed:
  signedBy?: string;
  signedAt?: string; // ISO datetime
  comments?: string;
}

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertCategory =
  | "OPS Approval"
  | "Aging Cases"
  | "Workload"
  | "Overdue Tasks"
  | "Case Event"
  | "Recovery";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  time: string; // human label
}
