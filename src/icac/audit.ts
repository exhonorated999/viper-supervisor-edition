// ICAC audit log (Phase 7).
//
// A local, append-only record of significant ICAC actions (unlock, import,
// assign, export, edits, role/vault changes). Stored in this machine's
// IndexedDB — never LAN-transmitted, and kept separate from the (possibly
// encrypted) intelligence database so it survives a locked vault. Capped to the
// most recent MAX_ENTRIES to bound growth.
// ---------------------------------------------------------------------------

import { idbGet, idbSet } from "./storage/idb";
import { loadIdentity } from "../data/identity";
import { getIcacRole, type IcacRole } from "./config";

const LOG_KEY = "auditlog";
const MAX_ENTRIES = 2000;

export type AuditAction =
  | "vault.enable"
  | "vault.unlock"
  | "vault.unlock.fail"
  | "vault.lock"
  | "vault.rekey"
  | "vault.disable"
  | "import"
  | "assign"
  | "assign.ack"
  | "export"
  | "tip.edit"
  | "tip.close"
  | "tip.reopen"
  | "role.change"
  | "audit.clear"
  | "ids.download"
  | "ids.ingest";

export interface AuditActor {
  name: string;
  badge: string;
  role: IcacRole;
}

export interface AuditEntry {
  id: string;
  at: string; // ISO
  action: AuditAction;
  detail?: string;
  actor: AuditActor;
}

let cache: AuditEntry[] | null = null;
let loading: Promise<AuditEntry[]> | null = null;
const subs = new Set<() => void>();

function notify() { for (const cb of subs) cb(); }

export function onAuditChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

async function ensureLoaded(): Promise<AuditEntry[]> {
  if (cache) return cache;
  if (loading) return loading;
  loading = idbGet<AuditEntry[]>(LOG_KEY)
    .then((v) => { cache = Array.isArray(v) ? v : []; return cache; })
    .catch(() => { cache = []; return cache; })
    .finally(() => { loading = null; });
  return loading;
}

/** Preload the log (e.g. before rendering the viewer). */
export async function loadAudit(): Promise<AuditEntry[]> {
  return ensureLoaded();
}

/** Synchronous snapshot (call loadAudit() first for freshness). */
export function getAuditEntries(): AuditEntry[] {
  return cache ?? [];
}

function currentActor(): AuditActor {
  const id = loadIdentity();
  return { name: id.name || "(unnamed)", badge: id.badge || "—", role: getIcacRole() };
}

/** Append an entry. Best-effort — never throws into the caller's flow. */
export async function logAudit(action: AuditAction, detail?: string): Promise<void> {
  try {
    const log = await ensureLoaded();
    const entry: AuditEntry = {
      id: `A-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      action,
      detail,
      actor: currentActor(),
    };
    log.push(entry);
    if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
    cache = log;
    await idbSet(LOG_KEY, log);
    notify();
  } catch {
    /* auditing must not break the primary action */
  }
}

/** Clear the log (records a final audit.clear entry with the reason). */
export async function clearAudit(reason: string): Promise<void> {
  cache = [];
  await idbSet(LOG_KEY, []);
  await logAudit("audit.clear", reason || "cleared");
}

/** Human labels for the viewer. */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  "vault.enable": "Encryption enabled",
  "vault.unlock": "Vault unlocked",
  "vault.unlock.fail": "Failed unlock attempt",
  "vault.lock": "Vault locked",
  "vault.rekey": "Passphrase changed",
  "vault.disable": "Encryption disabled",
  import: "CyberTips imported",
  assign: "CyberTip assigned",
  "assign.ack": "Assignment acknowledged",
  export: "Data exported",
  "tip.edit": "Tip edited",
  "tip.close": "CyberTip(s) closed",
  "tip.reopen": "CyberTip(s) reopened",
  "role.change": "Access role changed",
  "audit.clear": "Audit log cleared",
  "ids.download": "IDS download captured",
  "ids.ingest": "IDS batch ingested",
};
