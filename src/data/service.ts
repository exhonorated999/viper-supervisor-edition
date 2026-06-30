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
import { getDeviceKey, getDeviceIdSync } from "../lan/devicekey";
import { deriveStatsFromDelivery, deriveCasesFromDigest, deriveWorkloadFromDigest, deriveOpsPlanFromDelivery } from "./derive";

export type { SupervisorIdentity } from "./identity";

/** A trusted device as seen by the LAN node's trust store. */
export interface TrustedDevice {
  deviceId: string;
  role: string;
  name: string;
  badge: string;
  unit: string;
  firstSeen: string;
  lastSeen: string;
  revoked: boolean;
  online: boolean;
}

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

/**
 * Like read(), but first checks this supervisor's inbox for the most recent
 * snapshot an investigator pushed of the given delivery type. If one exists it
 * is reshaped (via `derive`) into the Dashboard's data shape, cached, and
 * returned — so a pushed stats/case snapshot actually populates the Dashboard
 * (not just the Inbox). Falls back to the plain RPC / cache / mock otherwise.
 */
async function readWithDelivery<K extends keyof Cache, T>(
  dtype: DeliveryType,
  rpcKind: string,
  cacheKey: K,
  fallback: T,
  derive: (d: Delivery) => T
): Promise<T> {
  await lanClient.waitForConnected(2500);
  try {
    const deliveries = await lanClient.request<Delivery[]>("get:deliveries");
    const latest = deliveries
      .filter((d) => d.dtype === dtype && d.body)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (latest) {
      const v = derive(latest);
      (cache as Record<string, unknown>)[cacheKey as string] = v;
      persist();
      return v;
    }
  } catch {
    /* fall through to the plain RPC / cache / mock */
  }
  return read(rpcKind, cacheKey, fallback);
}

/**
 * Build the supervisor's OPS-plan worklists from the inbox. Every opsPlan
 * delivery is reshaped into an OpsPlan; "pending" returns the ones still
 * awaiting a decision (newest first), "resolved" returns the signed/returned
 * ones. Falls back to the cached list / mock when offline. This is what makes
 * a pushed "Send for Approval" actually surface on the Dashboard + OPS Plans
 * screen (not only in the raw Inbox).
 */
async function readOpsPlans(which: "pending" | "resolved"): Promise<OpsPlan[]> {
  const cacheKey = which === "pending" ? "opsPending" : "opsSigned";
  const fallback = which === "pending" ? mockOpsPlans : mockSignedPlans;
  await lanClient.waitForConnected(2500);
  try {
    const deliveries = await lanClient.request<Delivery[]>("get:deliveries");
    const plans = deliveries
      .filter((d) => d.dtype === "opsPlan")
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .map((d) => deriveOpsPlanFromDelivery(d));
    const list =
      which === "pending"
        ? plans.filter((p) => p.status === "Pending")
        : plans.filter((p) => p.status === "Signed" || p.status === "Returned");
    (cache as Record<string, unknown>)[cacheKey] = list;
    persist();
    return list;
  } catch {
    return ((cache as Record<string, unknown>)[cacheKey] as OpsPlan[]) ?? fallback;
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
    // Warm the device key so the deviceId is available to the Settings UI.
    getDeviceKey().catch(() => {});
    lanClient.connect();
  },

  /** Expose the client for connection-state / live-event subscriptions. */
  lan: lanClient,

  getStats() {
    return readWithDelivery("stats", "get:stats", "stats", mockStats, (d) =>
      deriveStatsFromDelivery(d.body)
    );
  },
  getCases() {
    return readWithDelivery("caseStatus", "get:cases", "cases", mockCases, (d) =>
      deriveCasesFromDigest(d.body)
    );
  },
  getWorkload() {
    return readWithDelivery(
      "caseStatus",
      "get:workload",
      "workload",
      mockWorkload,
      (d) => deriveWorkloadFromDigest(d.body)
    );
  },
  getPendingOpsPlans() {
    return readOpsPlans("pending");
  },
  getSignedOpsPlans() {
    return readOpsPlans("resolved");
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

  /** This machine's stable deviceId (key fingerprint). */
  async getDeviceId(): Promise<string> {
    return (await getDeviceKey()).deviceId;
  },
  getDeviceIdSync(): string | null {
    return getDeviceIdSync();
  },

  // --- Secure-link config (node pin + URL) ---------------------------------
  getNodePin(): string | null { return lanClient.nodePin; },
  getNodeUrl(): string { return lanClient.nodeUrl; },
  setNodeUrl(url: string) { lanClient.setNodeUrl(url); },
  resetNodePin() { lanClient.resetNodePin(); },

  // --- Trust administration (supervisor) -----------------------------------
  async getTrustedDevices(): Promise<TrustedDevice[]> {
    try { return await lanClient.request<TrustedDevice[]>("get:trust"); }
    catch { return []; }
  },
  revokeDevice(deviceId: string): Promise<void> {
    lanClient.action("action:trust:revoke", { deviceId }).catch(() => {});
    return Promise.resolve();
  },
  unrevokeDevice(deviceId: string): Promise<void> {
    lanClient.action("action:trust:unrevoke", { deviceId }).catch(() => {});
    return Promise.resolve();
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
    // plan.id IS the delivery id (deriveOpsPlanFromDelivery), so route the
    // approval through the same decision path the Inbox uses — this flips the
    // delivery to "approved" on the node and notifies the investigator.
    lanClient
      .action("action:delivery:decision", {
        deliveryId: plan.id,
        decision: "approved",
        comments: signature.comments || "",
      })
      .catch(() => {
        /* queued offline; flushed on reconnect */
      });
    return Promise.resolve(signed);
  },

  returnOpsPlan(plan: OpsPlan, comments: string): Promise<OpsPlan> {
    const returned: OpsPlan = { ...plan, status: "Returned", comments };
    lanClient
      .action("action:delivery:decision", {
        deliveryId: plan.id,
        decision: "returned",
        comments,
      })
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
