// ---------------------------------------------------------------------------
// Dashboard customization preferences (local, per-machine).
//
// Two independent selections, mirroring Project V.I.P.E.R.:
//   • cardPrefs   — the metric shown by each top stat card (per-card gear).
//   • quickStats  — the 4 metrics shown in the Quick Stats panel (Configure
//                   Quick Stats modal).
// Both are plain arrays of catalog keys (see data/metrics.ts) persisted to
// localStorage. Changes emit a window event so every mounted view refreshes.
// ---------------------------------------------------------------------------

import { METRIC_BY_KEY } from "./metrics";
import type { SecondaryPeriod } from "./periods";

const CARD_KEY = "viperSupCardPreferences";
const QUICK_KEY = "viperSupQuickStats";
const PERIOD_KEY = "viperSupSecondaryPeriod";
const EVT = "viper-sup-prefs-change";

/** Default top stat cards (5 across the row). */
export const CARD_DEFAULTS = [
  "new_cases_assigned",
  "open_cases",
  "cases_closed",
  "arrests",
  "closed_with_arrest",
];

/** Default Quick Stats panel (exactly 4) — matches VIPER's default set. */
export const QUICK_DEFAULTS = ["open_cases", "cases_closed", "arrests", "narcotics_seized"];

export const QUICK_STATS_COUNT = 4;

function readArr(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return [...fallback];
    // Drop any keys no longer in the catalog (forward-compat).
    const clean = arr.filter((k) => typeof k === "string" && METRIC_BY_KEY[k]);
    return clean.length ? clean : [...fallback];
  } catch {
    return [...fallback];
  }
}

function writeArr(key: string, arr: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    /* ignore quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* non-DOM env */
  }
}

// --- Top stat cards -------------------------------------------------------

export function getCardPrefs(): string[] {
  return readArr(CARD_KEY, CARD_DEFAULTS);
}

export function setCardPrefs(keys: string[]) {
  writeArr(CARD_KEY, keys);
}

/** Change the metric shown by a single card slot. */
export function setCardMetric(index: number, key: string) {
  const cur = getCardPrefs();
  if (index < 0 || index >= cur.length) return;
  cur[index] = key;
  writeArr(CARD_KEY, cur);
}

// --- Quick Stats panel ----------------------------------------------------

export function getQuickStats(): string[] {
  const arr = readArr(QUICK_KEY, QUICK_DEFAULTS);
  return arr.slice(0, QUICK_STATS_COUNT);
}

export function setQuickStats(keys: string[]) {
  writeArr(QUICK_KEY, keys.slice(0, QUICK_STATS_COUNT));
}

// --- Secondary reporting period -------------------------------------------
// Cards and Quick Stats always show the calendar month to date. This is the
// SECOND figure beside it — the supervisor's choice of Quarter, Year or
// All time (chosen with the toggle in the dashboard header).

export function getSecondaryPeriod(): SecondaryPeriod {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (v === "year" || v === "allTime") return v;
    return "quarter";
  } catch {
    return "quarter";
  }
}

export function setSecondaryPeriod(p: SecondaryPeriod) {
  try {
    localStorage.setItem(PERIOD_KEY, p);
  } catch {
    /* ignore quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* non-DOM env */
  }
}

// --- Change subscription --------------------------------------------------

/** Subscribe to any preference change (this tab or another). Returns unsub. */
export function onPrefsChange(cb: () => void): () => void {
  const local = () => cb();
  const storage = (e: StorageEvent) => {
    if (e.key === CARD_KEY || e.key === QUICK_KEY || e.key === PERIOD_KEY) cb();
  };
  window.addEventListener(EVT, local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVT, local);
    window.removeEventListener("storage", storage);
  };
}
