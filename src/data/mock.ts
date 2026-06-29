import type {
  Stats,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  Alert,
} from "../types";

// ---------------------------------------------------------------------------
// Offline fallback dataset.
//
// CLEAN SLATE: empty by design. When the LAN node is unreachable the dashboard
// shows honest empty states rather than seeded sample data. Real data arrives
// over the encrypted LAN link (node reads) and via investigator pushes (Inbox).
// ---------------------------------------------------------------------------

export const mockStats: Stats = {
  metrics: [],
  trend: [],
  totalCases: 0,
  breakdown: [],
};

export const mockCases: CaseStatus[] = [];

export const mockWorkload: InvestigatorWorkload[] = [];

export const mockOpsPlans: OpsPlan[] = [];

export const mockSignedPlans: OpsPlan[] = [];

export const mockAlerts: Alert[] = [];

export const mockSupervisor = {
  name: "",
  badge: "",
  unit: "",
};
