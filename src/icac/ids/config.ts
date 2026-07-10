// ICAC Data System (IDS) connection settings — local, per-machine.
//
// Stores the IDS portal URL, login credentials, and optional autofill selector
// overrides. Per the operator's choice these live in plain localStorage (NOT the
// encrypted ICAC vault). Nothing here ever crosses the LAN.
// ---------------------------------------------------------------------------

const KEY = "viper.supervisor.icac.ids";
const EVENT = "icac:ids-config";

export interface IdsConfig {
  url: string;
  username: string;
  password: string;
  autofill: boolean;      // attempt autofill automatically on page load
  autoIngest: boolean;    // (reserved) prompt to ingest as soon as a file lands
  /** Optional CSS selector overrides for fragile portals. Blank = auto-detect. */
  userSel: string;
  passSel: string;
  submitSel: string;
}

const DEFAULTS: IdsConfig = {
  url: "https://www.icacdatasystem.com/landing/login",
  username: "",
  password: "",
  autofill: true,
  autoIngest: false,
  userSel: "",
  passSel: "",
  submitSel: "",
};

export function getIdsConfig(): IdsConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setIdsConfig(patch: Partial<IdsConfig>): IdsConfig {
  const next = { ...getIdsConfig(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* ignore */ }
  return next;
}

export function hasIdsCreds(cfg: IdsConfig = getIdsConfig()): boolean {
  return !!(cfg.username && cfg.password);
}

export function onIdsConfigChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
