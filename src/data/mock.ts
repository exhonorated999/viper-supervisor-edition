import type {
  Stats,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  Alert,
} from "../types";

// ---------------------------------------------------------------------------
// Mock dataset — mirrors the approved dashboard mockup values.
// Replace by a LAN client later; shapes are defined in src/types.ts.
// ---------------------------------------------------------------------------

export const mockStats: Stats = {
  metrics: [
    { key: "casesOpened", label: "Cases Opened", value: "48", delta: "12%", deltaDirection: "up", comparison: "vs last month", scope: "MTD" },
    { key: "casesClosed", label: "Cases Closed", value: "36", delta: "8%", deltaDirection: "up", comparison: "vs last month", scope: "MTD" },
    { key: "arrests", label: "Arrests", value: "27", delta: "15%", deltaDirection: "up", comparison: "vs last month", scope: "MTD" },
    { key: "warrantsAuthored", label: "Warrants Authored", value: "31", delta: "10%", deltaDirection: "up", comparison: "vs last month", scope: "MTD" },
    { key: "moneyRecovered", label: "Money Recovered", value: "$128,450", delta: "23%", deltaDirection: "up", comparison: "vs last year", scope: "YTD" },
    { key: "gunsRecovered", label: "Guns Recovered", value: "19", delta: "27%", deltaDirection: "up", comparison: "vs last year", scope: "YTD" },
    { key: "transfers", label: "Transfers", value: "14", delta: "7%", deltaDirection: "up", comparison: "vs last year", scope: "YTD" },
  ],
  trend: [
    { label: "Apr 1", casesOpened: 22, casesClosed: 14, arrests: 6 },
    { label: "Apr 4", casesOpened: 30, casesClosed: 18, arrests: 9 },
    { label: "Apr 8", casesOpened: 38, casesClosed: 24, arrests: 12 },
    { label: "Apr 12", casesOpened: 44, casesClosed: 30, arrests: 15 },
    { label: "Apr 15", casesOpened: 52, casesClosed: 36, arrests: 18 },
    { label: "Apr 19", casesOpened: 61, casesClosed: 44, arrests: 21 },
    { label: "Apr 22", casesOpened: 70, casesClosed: 52, arrests: 24 },
    { label: "Apr 26", casesOpened: 78, casesClosed: 60, arrests: 26 },
    { label: "Apr 29", casesOpened: 88, casesClosed: 68, arrests: 27 },
  ],
  totalCases: 186,
  breakdown: [
    { state: "Open", count: 112, pct: 60 },
    { state: "Ongoing", count: 42, pct: 23 },
    { state: "Closed", count: 26, pct: 14 },
    { state: "Transferred", count: 6, pct: 3 },
  ],
};

export const mockCases: CaseStatus[] = [
  { caseNumber: "MC-2025-0418", detective: "Det. J. Martinez", state: "Ongoing", caseType: "Narcotics", description: "Suspected distribution ring, east district", openedDate: "2025-04-10", ageDays: 12, lastActivity: "Arrest Made", lastActivityKind: "Arrest", lastActivityDate: "2025-04-22" },
  { caseNumber: "MC-2025-0417", detective: "Det. S. Williams", state: "Ongoing", caseType: "Firearms", description: "Operation Broken Line — supply interdiction", openedDate: "2025-04-09", ageDays: 13, lastActivity: "Warrant Returned", lastActivityKind: "Warrant", lastActivityDate: "2025-04-22" },
  { caseNumber: "MC-2025-0416", detective: "Det. K. Johnson", state: "Ongoing", caseType: "Surveillance", description: "Eastview surveillance operation", openedDate: "2025-04-08", ageDays: 14, lastActivity: "Evidence Recovered", lastActivityKind: "Evidence", lastActivityDate: "2025-04-21" },
  { caseNumber: "MC-2025-0415", detective: "Det. M. Allen", state: "Closed", caseType: "Theft", description: "Westside property recovery", openedDate: "2025-03-20", ageDays: 32, lastActivity: "Case Closed", lastActivityKind: "Closed", lastActivityDate: "2025-04-21" },
  { caseNumber: "MC-2025-0414", detective: "Det. L. Chen", state: "Open", caseType: "Fraud", description: "Financial fraud — new assignment", openedDate: "2025-04-21", ageDays: 1, lastActivity: "New Case Assigned", lastActivityKind: "New Case", lastActivityDate: "2025-04-21" },
  { caseNumber: "MC-2025-0410", detective: "Det. J. Martinez", state: "Open", caseType: "Narcotics", description: "Confidential informant follow-up", openedDate: "2025-02-12", ageDays: 69, lastActivity: "Surveillance Logged", lastActivityKind: "Evidence", lastActivityDate: "2025-04-18" },
  { caseNumber: "MC-2025-0402", detective: "Det. S. Williams", state: "Open", caseType: "Firearms", description: "Straw purchase investigation", openedDate: "2025-02-05", ageDays: 76, lastActivity: "Interview Conducted", lastActivityKind: "Evidence", lastActivityDate: "2025-04-15" },
  { caseNumber: "MC-2025-0398", detective: "Det. K. Johnson", state: "Transferred", caseType: "Homicide", description: "Cross-jurisdiction transfer to county", openedDate: "2025-01-30", ageDays: 82, lastActivity: "Case Transferred", lastActivityKind: "Closed", lastActivityDate: "2025-04-12" },
];

export const mockWorkload: InvestigatorWorkload[] = [
  { id: "inv-1", name: "Det. Jason Martinez", initials: "JM", total: 42, open: 26, ongoing: 12, aging: 6, newMtd: 4, band: "High" },
  { id: "inv-2", name: "Det. Kevin Johnson", initials: "KJ", total: 31, open: 18, ongoing: 9, aging: 3, newMtd: 5, band: "Balanced" },
  { id: "inv-3", name: "Det. Sarah Williams", initials: "SW", total: 28, open: 16, ongoing: 8, aging: 2, newMtd: 3, band: "Balanced" },
  { id: "inv-4", name: "Det. Marcus Allen", initials: "MA", total: 22, open: 12, ongoing: 7, aging: 1, newMtd: 2, band: "Light" },
  { id: "inv-5", name: "Det. Lisa Chen", initials: "LC", total: 19, open: 11, ongoing: 5, aging: 0, newMtd: 3, band: "Light" },
];

export const mockOpsPlans: OpsPlan[] = [
  { id: "OPS-2025-0417", title: "Southview Narcotics Operation", detective: "Det. J. Martinez", submittedDate: "2025-04-22", risk: "High Risk", status: "Pending", summary: "Coordinated entry on suspected distribution residence. Requests tactical support, two-team breach, and EMS on standby. Surveillance confirms armed occupants." },
  { id: "OPS-2025-0416", title: "Operation Broken Line", detective: "Det. T. Williams", submittedDate: "2025-04-21", risk: "Medium Risk", status: "Pending", summary: "Controlled buy operation at the river district warehouse. Single CI insertion with perimeter overwatch. Contingency exfil routes mapped." },
  { id: "OPS-2025-0415", title: "Eastview Surveillance Plan", detective: "Det. K. Johnson", submittedDate: "2025-04-21", risk: "Low Risk", status: "Pending", summary: "72-hour static surveillance of target location. No contact anticipated. Photographic and pattern-of-life documentation only." },
];

export const mockSignedPlans: OpsPlan[] = [
  { id: "OPS-2025-0413", title: "Westside Surveillance Plan", detective: "Det. M. Allen", submittedDate: "2025-04-20", risk: "Low Risk", status: "Signed", summary: "Routine surveillance authorization.", signedBy: "Sgt. M. Reynolds", signedAt: "2025-04-20T14:32:00", comments: "Approved as written." },
];

export const mockAlerts: Alert[] = [
  { id: "al-1", severity: "critical", category: "OPS Approval", title: "2 OPS Plans awaiting approval", detail: "Requires your review and signature", time: "10:28 AM" },
  { id: "al-2", severity: "warning", category: "Aging Cases", title: "3 Cases past 60 days", detail: "Require attention", time: "09:15 AM" },
  { id: "al-3", severity: "warning", category: "Workload", title: "Det. J. Martinez workload high", detail: "42 total cases assigned", time: "08:47 AM" },
  { id: "al-4", severity: "info", category: "Overdue Tasks", title: "Overdue Tasks", detail: "5 tasks past due", time: "08:30 AM" },
  { id: "al-5", severity: "info", category: "Recovery", title: "Major Recovery Logged", detail: "$15,200 recovered", time: "Yesterday" },
];

export const mockSupervisor = {
  name: "Sgt. Michael Reynolds",
  badge: "#4521",
  unit: "Major Crimes Unit",
};
