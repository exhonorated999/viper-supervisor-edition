// ICAC module configuration (local, per-machine).
//
// The ICAC subsystem is OPTIONAL — off by default. This module owns the enabled
// flag + a display label for the chosen storage location, both in localStorage,
// and a tiny pub/sub so the app chrome (nav tab) reacts to toggles instantly.
// ---------------------------------------------------------------------------

const ENABLED_KEY = "viper.supervisor.icac.enabled";
const LOCATION_KEY = "viper.supervisor.icac.location";
const EVENT = "icac:config";

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
