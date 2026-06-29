// ---------------------------------------------------------------------------
// Data service boundary.
//
// This is the SINGLE seam between the UI and the data source. Today every
// function resolves from the local mock dataset. When the LAN handshake layer
// lands, only this file changes — each call becomes a request to the encrypted
// LAN client, returning the SAME shapes (see src/types.ts). UI code imports
// from here exclusively and never touches mock.ts directly.
// ---------------------------------------------------------------------------

import type {
  Stats,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  Alert,
} from "../types";
import {
  mockStats,
  mockCases,
  mockWorkload,
  mockOpsPlans,
  mockSignedPlans,
  mockAlerts,
  mockSupervisor,
} from "./mock";

// Simulated latency so the UI's loading/animation paths are exercised the way
// they would be against a real LAN round-trip.
const LATENCY_MS = 250;

function resolve<T>(value: T): Promise<T> {
  return new Promise((res) => setTimeout(() => res(structuredClone(value)), LATENCY_MS));
}

export interface SupervisorIdentity {
  name: string;
  badge: string;
  unit: string;
}

export const dataService = {
  /** Unit-level stats payload (metrics + trend + breakdown). */
  getStats(): Promise<Stats> {
    return resolve(mockStats);
  },

  /** Read-only case records mirrored from investigator devices. */
  getCases(): Promise<CaseStatus[]> {
    return resolve(mockCases);
  },

  /** Aggregated per-investigator workload rows. */
  getWorkload(): Promise<InvestigatorWorkload[]> {
    return resolve(mockWorkload);
  },

  /** OPS plans pending supervisor review / sign-off. */
  getPendingOpsPlans(): Promise<OpsPlan[]> {
    return resolve(mockOpsPlans);
  },

  /** Recently signed OPS plans (digital sign-off history). */
  getSignedOpsPlans(): Promise<OpsPlan[]> {
    return resolve(mockSignedPlans);
  },

  /** Active alerts & notifications. */
  getAlerts(): Promise<Alert[]> {
    return resolve(mockAlerts);
  },

  /** Logged-in supervisor identity. */
  getSupervisor(): Promise<SupervisorIdentity> {
    return resolve(mockSupervisor);
  },

  /**
   * Digitally sign an OPS plan. In the LAN build this pushes the signature
   * back to the originating investigator device and writes the audit log.
   * For the prototype it just echoes the signed record.
   */
  signOpsPlan(
    plan: OpsPlan,
    signature: { signedBy: string; comments?: string }
  ): Promise<OpsPlan> {
    const signed: OpsPlan = {
      ...plan,
      status: "Signed",
      signedBy: signature.signedBy,
      signedAt: new Date().toISOString(),
      comments: signature.comments,
    };
    return resolve(signed);
  },

  /**
   * Return an OPS plan to the investigator with required comments.
   */
  returnOpsPlan(plan: OpsPlan, comments: string): Promise<OpsPlan> {
    const returned: OpsPlan = { ...plan, status: "Returned", comments };
    return resolve(returned);
  },
};
