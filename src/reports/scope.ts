// ---------------------------------------------------------------------------
// Reporting scope — the time window a report covers.
//
// Two flavours, and the distinction matters for how honest the numbers are:
//
//   PRESET  (month | quarter | year | allTime)
//     Uses the metric buckets the investigator computed and pushed. These are
//     AUTHORITATIVE — they come from the same engine that draws the
//     investigator's own dashboard, so a supervisor report matches what the
//     detective sees on their screen.
//
//   CUSTOM  (any start/end pair)
//     No investigator ever computed a bucket for "March 3rd to April 11th", so
//     there is nothing on the wire to read. Instead we count the redacted,
//     metadata-only activity events that ride along in the case-status digest
//     (see CaseActivity in types.ts). That covers case/warrant/evidence/report
//     activity but NOT the standing counters (money seized, devices by tool,
//     …) which were never event-stamped. Anything we cannot honestly derive is
//     reported as unavailable rather than as a zero.
//
// Everything here is pure + local. No network, no case content.
// ---------------------------------------------------------------------------

import type { CaseStatus } from "../types";
import type { PeriodKey, PeriodLabels } from "../data/periods";
import { periodLabel } from "../data/periods";

export type ScopeMode = "preset" | "custom";

export interface ReportScope {
  mode: ScopeMode;
  /** Only meaningful when mode === "preset". */
  preset: PeriodKey;
  /** ISO yyyy-mm-dd, only meaningful when mode === "custom". */
  start: string;
  end: string;
}

/** A scope resolved to concrete instants + display text. */
export interface ResolvedScope {
  mode: ScopeMode;
  /** Present for preset scopes; null for custom ranges. */
  periodKey: PeriodKey | null;
  /** Inclusive lower bound. null === beginning of time (all-time preset). */
  from: Date | null;
  /** Exclusive upper bound. null === no upper bound. */
  to: Date | null;
  /** Human label, e.g. "September 2026" or "3 Mar 2026 – 11 Apr 2026". */
  label: string;
  /** True when metric buckets can be read straight off the wire. */
  authoritative: boolean;
}

export function defaultScope(): ReportScope {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    mode: "preset",
    preset: "month",
    start: toInputDate(first),
    end: toInputDate(now),
  };
}

/** Date -> "yyyy-mm-dd" in LOCAL time (toISOString would shift the day). */
export function toInputDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "yyyy-mm-dd" -> local midnight. Returns null for junk input. */
function fromInputDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(+d) ? null : d;
}

const DATE_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/**
 * Turn the UI's scope selection into concrete bounds.
 *
 * Preset windows mirror VIPER's `viperPeriodWindow()` exactly (calendar based,
 * Q1 = Jan-Mar) so the supervisor's bounds and the investigator's buckets
 * always describe the same stretch of time.
 */
export function resolveScope(
  scope: ReportScope,
  labels: PeriodLabels,
  ref: Date = new Date()
): ResolvedScope {
  if (scope.mode === "custom") {
    const from = fromInputDate(scope.start);
    const endDay = fromInputDate(scope.end);
    // The picker's end date is inclusive to the user, so push the bound to the
    // following midnight — otherwise everything logged on the last day is lost.
    const to = endDay ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1) : null;
    const label =
      from && endDay
        ? `${from.toLocaleDateString(undefined, DATE_FMT)} – ${endDay.toLocaleDateString(undefined, DATE_FMT)}`
        : "Custom range";
    return { mode: "custom", periodKey: null, from, to, label, authoritative: false };
  }

  const y = ref.getFullYear();
  let from: Date | null = null;
  let to: Date | null = null;
  if (scope.preset === "month") {
    from = new Date(y, ref.getMonth(), 1);
    to = new Date(y, ref.getMonth() + 1, 1);
  } else if (scope.preset === "quarter") {
    const q = Math.floor(ref.getMonth() / 3);
    from = new Date(y, q * 3, 1);
    to = new Date(y, q * 3 + 3, 1);
  } else if (scope.preset === "year") {
    from = new Date(y, 0, 1);
    to = new Date(y + 1, 0, 1);
  }
  return {
    mode: "preset",
    periodKey: scope.preset,
    from,
    to,
    label: periodLabel(scope.preset, labels),
    authoritative: true,
  };
}

function inScope(iso: string | undefined, s: ResolvedScope): boolean {
  if (!iso) return false;
  // Date-only strings must be read as LOCAL midnight; `new Date("2026-09-04")`
  // is UTC and lands on the 3rd for anyone west of Greenwich.
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T00:00:00" : iso;
  const d = new Date(raw);
  if (isNaN(+d)) return false;
  if (s.from && d < s.from) return false;
  if (s.to && d >= s.to) return false;
  return true;
}

/**
 * Cases that saw activity inside the window. All-time scopes keep everything;
 * a case with no activity feed falls back to its last-activity date.
 */
export function filterCasesByScope(cases: CaseStatus[], s: ResolvedScope): CaseStatus[] {
  if (!s.from && !s.to) return cases;
  return cases.filter((c) => {
    const events = c.activity?.events;
    if (events?.length) return events.some((e) => inScope(e.date, s));
    return inScope(c.lastActivityDate || c.openedDate, s);
  });
}

/** Counts we can honestly derive from the redacted digest for ANY window. */
export interface ActivityTotals {
  casesTouched: number;
  casesOpened: number;
  casesClosed: number;
  arrests: number;
  warrantsSigned: number;
  warrantsServed: number;
  evidenceLogged: number;
  reportsFiled: number;
  fieldwork: number;
  totalEvents: number;
}

export const ACTIVITY_LABELS: Record<keyof ActivityTotals, string> = {
  casesTouched: "Cases With Activity",
  casesOpened: "Cases Opened",
  casesClosed: "Cases Closed",
  arrests: "Arrests",
  warrantsSigned: "Warrants Signed",
  warrantsServed: "Warrants Served",
  evidenceLogged: "Evidence Logged",
  reportsFiled: "Reports Filed",
  fieldwork: "Fieldwork Actions",
  totalEvents: "Total Activity Events",
};

/**
 * Roll the digest's activity events up over an arbitrary window.
 *
 * Event vocabulary is fixed by the investigator-side redactor
 * (supervisor-link-ui.js buildCaseActivity): category is one of
 * warrant | rms | digital | surveillance | fieldwork | custom, and `action` is
 * a curated label such as "Search warrant served" — never free text, so
 * matching on it is safe and leaks nothing.
 */
export function deriveActivityTotals(cases: CaseStatus[], s: ResolvedScope): ActivityTotals {
  const t: ActivityTotals = {
    casesTouched: 0, casesOpened: 0, casesClosed: 0, arrests: 0,
    warrantsSigned: 0, warrantsServed: 0, evidenceLogged: 0,
    reportsFiled: 0, fieldwork: 0, totalEvents: 0,
  };

  for (const c of cases) {
    const events = (c.activity?.events || []).filter((e) => inScope(e.date, s));
    if (events.length) t.casesTouched++;
    t.totalEvents += events.length;

    for (const e of events) {
      const a = String(e.action || "");
      if (/case opened/i.test(a)) t.casesOpened++;
      if (/arrest/i.test(a)) t.arrests++;
      if (e.category === "warrant") {
        if (/served/i.test(a)) t.warrantsServed++;
        else if (/signed/i.test(a)) t.warrantsSigned++;
      } else if (e.category === "digital") {
        t.evidenceLogged++;
      } else if (e.category === "rms") {
        t.reportsFiled++;
      } else if (e.category === "fieldwork" || e.category === "surveillance") {
        t.fieldwork++;
      }
    }

    // Closure isn't an event — it's the case's terminal state, so attribute it
    // to the window containing its last activity.
    if ((c.state === "Closed" || c.state === "Transferred") && inScope(c.lastActivityDate, s)) {
      t.casesClosed++;
    }
  }

  return t;
}

/** Month-by-month activity series for the charts, oldest → newest. */
export interface ActivityBucket {
  key: string;
  label: string;
  opened: number;
  closed: number;
  arrests: number;
  warrants: number;
}

export function deriveActivitySeries(cases: CaseStatus[], s: ResolvedScope): ActivityBucket[] {
  const map = new Map<string, ActivityBucket>();
  const bump = (iso: string, field: keyof Omit<ActivityBucket, "key" | "label">) => {
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T00:00:00" : iso;
    const d = new Date(raw);
    if (isNaN(+d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        label: new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString(undefined, {
          month: "short",
          year: "2-digit",
        }),
        opened: 0, closed: 0, arrests: 0, warrants: 0,
      };
      map.set(key, b);
    }
    b[field]++;
  };

  for (const c of cases) {
    for (const e of c.activity?.events || []) {
      if (!inScope(e.date, s)) continue;
      const a = String(e.action || "");
      if (/case opened/i.test(a)) bump(e.date, "opened");
      if (/arrest/i.test(a)) bump(e.date, "arrests");
      if (e.category === "warrant") bump(e.date, "warrants");
    }
    if ((c.state === "Closed" || c.state === "Transferred") && inScope(c.lastActivityDate, s)) {
      bump(c.lastActivityDate, "closed");
    }
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
