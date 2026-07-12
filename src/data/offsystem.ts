// ---------------------------------------------------------------------------
// Off-System roster + cases (local, per-machine).
//
// Lets a supervisor use V.I.P.E.R. even when their officers do NOT run Project
// V.I.P.E.R. Manual investigators can be added by hand and assigned CyberTips
// (local-only, never pushed over the LAN) plus lightweight "manual case"
// records the supervisor tracks themselves.
//
// Deliberately GENERAL (not part of the ICAC index) so it works with the ICAC
// module OFF and the LAN DOWN. Plain localStorage, mirroring data/prefs.ts.
// Nothing here ever crosses the network.
// ---------------------------------------------------------------------------

const INV_KEY = "viperSupManualInvestigators";
const CASE_KEY = "viperSupManualCases";
const EVT = "viper-sup-offsystem-change";

/** A manually-added investigator who does not run Project V.I.P.E.R. */
export interface ManualInvestigator {
  id: string;
  name: string;
  badge?: string;
  unit?: string;
  email?: string;
  createdAt: string;
}

/** A lightweight, supervisor-authored case tracked locally on this machine. */
export interface ManualCase {
  id: string;
  case_number: string;
  title: string;
  assignee_id?: string;
  assignee_name?: string;
  note?: string;
  /** "manual" = off-system investigator; "lan" = pushed to an on-network one. */
  mode?: "manual" | "lan";
  createdAt: string;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
}

function writeArr<T>(key: string, arr: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* non-DOM */ }
}

// --- Manual investigators --------------------------------------------------

export function getManualInvestigators(): ManualInvestigator[] {
  return readArr<ManualInvestigator>(INV_KEY);
}

export function addManualInvestigator(
  data: Omit<ManualInvestigator, "id" | "createdAt">,
): ManualInvestigator {
  const inv: ManualInvestigator = { ...data, id: genId("MI"), createdAt: new Date().toISOString() };
  const all = getManualInvestigators();
  all.push(inv);
  writeArr(INV_KEY, all);
  return inv;
}

export function updateManualInvestigator(inv: ManualInvestigator): void {
  const all = getManualInvestigators();
  const i = all.findIndex((x) => x.id === inv.id);
  if (i < 0) return;
  all[i] = inv;
  writeArr(INV_KEY, all);
}

export function removeManualInvestigator(id: string): void {
  writeArr(INV_KEY, getManualInvestigators().filter((x) => x.id !== id));
}

// --- Manual cases ----------------------------------------------------------

export function getManualCases(): ManualCase[] {
  return readArr<ManualCase>(CASE_KEY);
}

export function addManualCase(data: Omit<ManualCase, "id" | "createdAt">): ManualCase {
  const c: ManualCase = { ...data, id: genId("MC"), createdAt: new Date().toISOString() };
  const all = getManualCases();
  all.push(c);
  writeArr(CASE_KEY, all);
  return c;
}

export function updateManualCase(c: ManualCase): void {
  const all = getManualCases();
  const i = all.findIndex((x) => x.id === c.id);
  if (i < 0) return;
  all[i] = c;
  writeArr(CASE_KEY, all);
}

export function removeManualCase(id: string): void {
  writeArr(CASE_KEY, getManualCases().filter((x) => x.id !== id));
}

// --- Change subscription ---------------------------------------------------

/** Subscribe to any off-system roster/case change (this tab or another). */
export function onOffSystemChange(cb: () => void): () => void {
  const local = () => cb();
  const storage = (e: StorageEvent) => {
    if (e.key === INV_KEY || e.key === CASE_KEY) cb();
  };
  window.addEventListener(EVT, local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVT, local);
    window.removeEventListener("storage", storage);
  };
}
