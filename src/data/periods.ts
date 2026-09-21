// ---------------------------------------------------------------------------
// Reporting periods for the dashboard stats.
//
// Every stat card and Quick Stat tile shows TWO figures:
//   • the calendar month to date (always visible), and
//   • a secondary figure the supervisor toggles between Quarter and Year.
// All-time remains as the small caption so nothing that used to be on screen
// disappeared.
//
// Periods are CALENDAR based (Q1 = Jan-Mar, year = Jan 1 → Dec 31), matching
// how the investigator app buckets them (index.html viperPeriodWindow). The
// labels here are only a *fallback* — an investigator push carries its own
// `periods` labels, which win so both apps always agree on the wording.
// ---------------------------------------------------------------------------

/** The buckets that arrive on the wire from an investigator stats push. */
export type PeriodKey = "month" | "quarter" | "year" | "allTime";

/** The periods the secondary card figure can be switched between. */
export type SecondaryPeriod = "quarter" | "year" | "allTime";

/** The toggle buttons rendered in the dashboard header, in order. */
export const SECONDARY_CHOICES: SecondaryPeriod[] = ["quarter", "year", "allTime"];

export const PERIOD_ORDER: PeriodKey[] = ["month", "quarter", "year", "allTime"];

/** Short uppercase tag rendered under each figure. */
export type PeriodLabels = Record<PeriodKey, string>;

/** A unit-wide, period-bucketed metric set. */
export interface PeriodMetrics {
  /** metric key -> summed value, per period. */
  buckets: Record<PeriodKey, Record<string, number>>;
  /** Display labels ("September 2026", "Q3 2026", "2026", "All time"). */
  labels: PeriodLabels;
  /**
   * False when no investigator on the unit has pushed period buckets yet
   * (i.e. every snapshot came from a pre-period VIPER build). The UI degrades
   * to the all-time figure with an explanatory caption in that case.
   */
  hasPeriodData: boolean;
  /** Investigators whose latest snapshot predates period support. */
  staleSenders: string[];
}

/** Calendar-period labels for "now" — used when the wire carries none. */
export function currentPeriodLabels(ref?: Date): PeriodLabels {
  const now = ref ? new Date(ref) : new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return {
    month: new Date(y, now.getMonth(), 1).toLocaleString(undefined, { month: "long" }) + " " + y,
    quarter: `Q${q} ${y}`,
    year: String(y),
    allTime: "All time",
  };
}

/** Compact tag shown directly beneath a figure (fits a narrow card column). */
export function periodTag(period: PeriodKey, labels: PeriodLabels): string {
  switch (period) {
    case "month":
      // "September 2026" -> "SEP MTD"
      return labels.month.slice(0, 3).toUpperCase() + " MTD";
    case "quarter":
      // "Q3 2026" -> "Q3 QTD"
      return (labels.quarter.split(" ")[0] || "Q").toUpperCase() + " QTD";
    case "year":
      return "YTD " + labels.year;
    default:
      return "ALL TIME";
  }
}

/** Full human label, e.g. for tooltips and report headers. */
export function periodLabel(period: PeriodKey, labels: PeriodLabels): string {
  return labels[period] || period;
}

/** An empty period set — the pre-sync state. */
export function emptyPeriodMetrics(): PeriodMetrics {
  return {
    buckets: { month: {}, quarter: {}, year: {}, allTime: {} },
    labels: currentPeriodLabels(),
    hasPeriodData: false,
    staleSenders: [],
  };
}
