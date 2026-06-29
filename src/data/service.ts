// ---------------------------------------------------------------------------
// Data service boundary.
//
// The SINGLE seam between the UI and the data source. It now flows through the
// encrypted LAN client (src/lan/client.ts):
//   - reads  -> lanClient.request(...)  with cache + bundled-mock fallback so
//               the UI never hangs when the node is unreachable (offline-tolerant)
//   - writes -> lanClient.action(...)   queued offline, flushed on reconnect;
//               applied optimistically so the UI stays responsive.
// When the real investigator-device transport replaces the node, nothing here
// or in the UI changes — only the wire endpoint.
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
} from "./mock";
import { lanClient } from "../lan/client";
import { loadIdentity, saveIdentity } from "./identity";
import type { SupervisorIdentity } from "./identity";

export type { SupervisorIdentity } from "./identity";

/** A dataset/OPS-plan pushed from an investigator device to this supervisor. */
export type DeliveryType = "stats" | "caseStatus" | "opsPlan";

export interface Delivery {
  id: string;
  dtype: DeliveryType;
  from: string; // investigator name
  fromBadge: string;
  fromDeviceId: string;
  to: string; // supervisor deviceId
  manifest: Record<string, any>; // small summary (title, caseNumber, counts…)
  body: any; // stats JSON / digest rows / { pdfBase64, fileName }
  sentAt: string;
  status: "unread" | "read" | "approved" | "returned";
  decision?: { by: string; decision: string; comments: string; at: string };
}

export interface AuditEntry {
  ts: string;
  actor: string;
  role: string;
  action: string;
  target?: string;
  result: string;
}

const CACHE_KEY = "viper.lan.cache.v1";

type Cache = {
  stats?: Stats;
  cases?: CaseStatus[];
  workload?: InvestigatorWorkload[];
  opsPending?: OpsPlan[];
  opsSigned?: OpsPlan[];
  alerts?: Alert[];
};

let cache: Cache = loadCache();

function loadCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota / availability */
  }
}

let started = false;

async function read<K extends keyof Cache, T>(
  kind: string,
  cacheKey: K,
  fallback: T
): Promise<T> {
  // Give the handshake a brief window on first paint, then fall back.
  await lanClient.waitForConnected(2500);
  try {
    const v = await lanClient.request<T>(kind);
    (cache as Record<string, unknown>)[cacheKey as string] = v;
    persist();
    return v;
  } catch {
    return ((cache as Record<string, unknown>)[cacheKey as string] as T) ?? fallback;
  }
}

export const dataService = {
  /** Begin connecting to the LAN node (idempotent). */
  start() {
    if (started) return;
    started = true;
    // Register this machine under its Settings identity before connecting so
    // investigators see the correct name/unit in their push picker.
    const id = loadIdentity();
    lanClient.setIdentity({ role: "supervisor", ...id });
    lanClient.connect();
  },

  /** Expose the client for connection-state / live-event subscriptions. */
  lan: lanClient,

  getStats() {
    return read("get:stats", "stats", mockStats);
  },
  getCases() {
    return read("get:cases", "cases", mockCases);
  },
  getWorkload() {
    return read("get:workload", "workload", mockWorkload);
  },
  getPendingOpsPlans() {
    return read("get:ops:pending", "opsPending", mockOpsPlans);
  },
  getSignedOpsPlans() {
    return read("get:ops:signed", "opsSigned", mockSignedPlans);
  },
  getAlerts() {
    return read("get:alerts", "alerts", mockAlerts);
  },

  async getAudit(): Promise<AuditEntry[]> {
    try {
      return await lanClient.request<AuditEntry[]>("get:audit");
    } catch {
      return [];
    }
  },

  async getSupervisor(): Promise<SupervisorIdentity> {
    const id = loadIdentity();
    // Prefer the unit the node confirmed for this session, else Settings.
    return { ...id, unit: lanClient.session?.unit || id.unit };
  },

  /** Current registered identity (synchronous, for Settings form). */
  getIdentity(): SupervisorIdentity {
    return loadIdentity();
  },

  /** Persist a new identity and re-register with the LAN node. */
  updateIdentity(next: SupervisorIdentity): SupervisorIdentity {
    saveIdentity(next);
    lanClient.setIdentity({ role: "supervisor", ...next });
    return next;
  },

  // --- Inbox (incoming deliveries from investigators) ----------------------

  /** Pull this supervisor's inbox from the node (cache-less; small payloads). */
  async getDeliveries(): Promise<Delivery[]> {
    try {
      return await lanClient.request<Delivery[]>("get:deliveries");
    } catch {
      return [];
    }
  },

  /** Mark a delivery as read. */
  ackDelivery(deliveryId: string): Promise<void> {
    lanClient.action("action:delivery:ack", { deliveryId }).catch(() => {});
    return Promise.resolve();
  },

  /** Approve or return an OPS-plan delivery; routes the decision back. */
  decideDelivery(
    deliveryId: string,
    decision: "approved" | "returned",
    comments: string
  ): Promise<void> {
    lanClient
      .action("action:delivery:decision", { deliveryId, decision, comments })
      .catch(() => {});
    return Promise.resolve();
  },

  /** Sign an OPS plan — optimistic locally, authoritative write over LAN. */
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
    lanClient
      .action("action:ops:sign", {
        planId: plan.id,
        signedBy: signature.signedBy,
        comments: signature.comments,
      })
      .catch(() => {
        /* queued offline; flushed on reconnect */
      });
    return Promise.resolve(signed);
  },

  returnOpsPlan(plan: OpsPlan, comments: string): Promise<OpsPlan> {
    const returned: OpsPlan = { ...plan, status: "Returned", comments };
    lanClient
      .action("action:ops:return", { planId: plan.id, comments })
      .catch(() => {});
    return Promise.resolve(returned);
  },

  assignCase(input: {
    caseNumber: string;
    description: string;
    detective: string;
    priority?: string;
    assignedDate?: string;
  }): Promise<CaseStatus> {
    const newCase: CaseStatus = {
      caseNumber: input.caseNumber,
      detective: input.detective,
      state: "Open",
      caseType: "Unassigned",
      description: input.description,
      openedDate: input.assignedDate || new Date().toISOString().slice(0, 10),
      ageDays: 0,
      lastActivity: "New Case Assigned",
      lastActivityKind: "New Case",
      lastActivityDate: new Date().toISOString().slice(0, 10),
    };
    lanClient.action("action:case:assign", input).catch(() => {});
    return Promise.resolve(newCase);
  },

  /**
   * Deliberately attempt a forbidden action to demonstrate RBAC enforcement.
   * The node denies it (supervisors are read-only on case content) and writes
   * a DENIED entry to the audit log. Resolves with the denial reason.
   */
  async attemptForbiddenEdit(): Promise<string> {
    try {
      await lanClient.request("action:case:edit", { caseNumber: "MC-2025-0418" });
      return "UNEXPECTED_ALLOW";
    } catch (e: any) {
      return String(e?.message || e);
    }
  },
};
