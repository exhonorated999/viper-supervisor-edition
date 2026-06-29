// ---------------------------------------------------------------------------
// Canonical dataset served by the LAN node.
//
// CLEAN SLATE: in the push model the supervisor owns no seeded case content —
// all real data arrives as deliveries pushed from investigator devices (which
// land in the Inbox). These read RPCs therefore return empty/zeroed shapes so
// the dashboard shows honest empty states until live data is received.
//
// Shapes mirror src/types.ts; keep the keys so the UI renders empty states
// instead of crashing on undefined.
// ---------------------------------------------------------------------------

export function buildDataset() {
  return {
    stats: {
      metrics: [],
      trend: [],
      totalCases: 0,
      breakdown: [],
    },
    cases: [],
    workload: [],
    opsPending: [],
    opsSigned: [],
    alerts: [],
    unit: { name: "" },
  };
}

// Retained for API compatibility with server.mjs (the live-event demo
// generator is disabled in the clean build, so these pools are unused).
export const liveEventPool = {
  opsPlans: [],
  activity: [],
};
