// ICAC module configuration (local, per-machine).
//
// The ICAC subsystem is OPTIONAL — off by default. This module owns the enabled
// flag + a display label for the chosen storage location, both in localStorage,
// and a tiny pub/sub so the app chrome (nav tab) reacts to toggles instantly.
// ---------------------------------------------------------------------------

const ENABLED_KEY = "viper.supervisor.icac.enabled";
const LOCATION_KEY = "viper.supervisor.icac.location";
const ROLE_KEY = "viper.supervisor.icac.role";
const EVENT = "icac:config";

/** ICAC access mode (Phase 7 RBAC). command = full; readonly = view-only. */
export type IcacRole = "command" | "readonly";

export function getIcacRole(): IcacRole {
  try { return localStorage.getItem(ROLE_KEY) === "readonly" ? "readonly" : "command"; } catch { return "command"; }
}

export function setIcacRole(role: IcacRole): void {
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* ignore */ }
  emit();
}

/** Whether the current role may perform mutating actions (import/assign/export). */
export function canMutate(): boolean {
  return getIcacRole() === "command";
}

export function isIcacEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; }
}

export function setIcacEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  emit();
}

/** Human-readable label of the chosen DB location (folder/USB or fallback). */
export function getIcacLocationLabel(): string | null {
  try { return localStorage.getItem(LOCATION_KEY); } catch { return null; }
}

export function setIcacLocationLabel(label: string | null): void {
  try {
    if (label) localStorage.setItem(LOCATION_KEY, label);
    else localStorage.removeItem(LOCATION_KEY);
  } catch { /* ignore */ }
  emit();
}

function emit(): void {
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* ignore */ }
}

/** Subscribe to any ICAC config change. Returns an unsubscribe fn. */
export function onIcacConfigChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  // also react to changes from other tabs
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
