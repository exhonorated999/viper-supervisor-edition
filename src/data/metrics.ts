// ---------------------------------------------------------------------------
// Unit metric catalog — the full set of stats the Supervisor dashboard can
// display, ported 1:1 (keys + labels + subtitles) from Project V.I.P.E.R.'s
// investigator dashboard (index.html `dashboardMetrics` / `metricLabels`).
//
// The supervisor never *computes* these from case content (it has none). The
// numeric values arrive unit-wide over the LAN: each investigator's stats push
// now carries a `metrics` map { key -> number }; the supervisor sums the latest
// snapshot per investigator (see data/service.getMetricValues + derive).
//
// Cards + Quick Stats are configurable (data/prefs.ts). This catalog is the
// single source of truth for "which metrics exist" and how each is presented.
// ---------------------------------------------------------------------------

export type MetricFormat = "number" | "currency";

export interface MetricDef {
  /** Stable storage key, matches the investigator push + VIPER dashboardMetrics. */
  key: string;
  /** Display label. */
  label: string;
  /** Sub-caption under the value. */
  subtitle: string;
  /** Card accent colour (hex or css var). */
  accent: string;
  /** How to render the numeric value. */
  format: MetricFormat;
}

// Colour aliases mapped onto the Supervisor palette (styles.css :root).
const ORANGE = "#f0883e";
const CYAN = "var(--cyan)";
const PURPLE = "#b47cff";
const GREEN = "var(--green)";
const YELLOW = "var(--amber)";

export const METRIC_CATALOG: MetricDef[] = [
  { key: "arrests",                 label: "Arrests",                 subtitle: "All time",               accent: ORANGE, format: "number" },
  { key: "recovered_guns",          label: "Recovered Guns",          subtitle: "All time",               accent: CYAN,   format: "number" },
  { key: "recovered_vehicles",      label: "Recovered Vehicles",      subtitle: "All time",               accent: PURPLE, format: "number" },
  { key: "rescued_individuals",     label: "Rescued Individuals",     subtitle: "All time",               accent: GREEN,  format: "number" },
  { key: "located_missing",         label: "Located Missing",         subtitle: "All time",               accent: CYAN,   format: "number" },
  { key: "new_cases_assigned",      label: "New Cases Assigned",      subtitle: "All time",               accent: CYAN,   format: "number" },
  { key: "cases_closed",            label: "Cases Closed",            subtitle: "All time",               accent: GREEN,  format: "number" },
  { key: "narcotics_seized",        label: "Narcotics Seized",        subtitle: "All time",               accent: PURPLE, format: "number" },
  { key: "money_seized",            label: "Money Seized",            subtitle: "All time",               accent: GREEN,  format: "currency" },
  { key: "cargo_recovered",         label: "Cargo Recovered",         subtitle: "All time",               accent: GREEN,  format: "number" },
  { key: "cargo_loss",              label: "Cargo Loss",              subtitle: "All time",               accent: ORANGE, format: "number" },
  { key: "missing_persons",         label: "Missing Persons",         subtitle: "Active cases",           accent: ORANGE, format: "number" },
  { key: "open_cases",              label: "Open Cases",              subtitle: "Active investigations",  accent: ORANGE, format: "number" },
  { key: "inactive_cases",          label: "Inactive",                subtitle: "On hold / paused",       accent: YELLOW, format: "number" },
  { key: "closed_with_arrest",      label: "Closed w/ Arrest",        subtitle: "All time",               accent: GREEN,  format: "number" },
  { key: "transferred_cases",       label: "Transferred Cases",       subtitle: "All time",               accent: PURPLE, format: "number" },
  { key: "warrants_written",        label: "Warrants Written",        subtitle: "All time",               accent: ORANGE, format: "number" },
  { key: "devices_examined",        label: "Devices Examined",        subtitle: "All time",               accent: CYAN,   format: "number" },
  { key: "devices_pending_review",  label: "Devices Pending Review",  subtitle: "Awaiting review",        accent: YELLOW, format: "number" },
  { key: "devices_tool_cellebrite", label: "Devices · Cellebrite",    subtitle: "Cellebrite",             accent: CYAN,   format: "number" },
  { key: "devices_tool_datapilot",  label: "Devices · DataPilot",     subtitle: "DataPilot",              accent: PURPLE, format: "number" },
  { key: "devices_tool_magnet",     label: "Devices · Magnet AXIOM",  subtitle: "Magnet AXIOM",           accent: GREEN,  format: "number" },
  { key: "devices_tool_graykey",    label: "Devices · GrayKey",       subtitle: "GrayKey",                accent: ORANGE, format: "number" },
  { key: "devices_tool_ftk",        label: "Devices · FTK Imager",    subtitle: "FTK Imager",             accent: CYAN,   format: "number" },
  { key: "devices_tool_other",      label: "Devices · Other Tool",    subtitle: "Other tools",            accent: PURPLE, format: "number" },
  { key: "devices_cat_phone",       label: "Devices · Cell Phones",   subtitle: "Cell Phones",            accent: CYAN,   format: "number" },
  { key: "devices_cat_computer",    label: "Devices · Computers",     subtitle: "Computers",              accent: PURPLE, format: "number" },
  { key: "devices_cat_tablet",      label: "Devices · Tablets",       subtitle: "Tablets",                accent: GREEN,  format: "number" },
  { key: "devices_cat_drive",       label: "Devices · External Drives", subtitle: "External Drives",      accent: ORANGE, format: "number" },
  { key: "devices_cat_other",       label: "Devices · Other Category", subtitle: "Other devices",         accent: PURPLE, format: "number" },
];

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  METRIC_CATALOG.map((m) => [m.key, m])
);

export function metricDef(key: string): MetricDef {
  return (
    METRIC_BY_KEY[key] || {
      key,
      label: key,
      subtitle: "",
      accent: "var(--blue)",
      format: "number",
    }
  );
}

/** Format a raw metric number for display per its catalog format. */
export function formatMetricValue(key: string, value: number | null | undefined): string {
  const def = metricDef(key);
  if (value == null || !Number.isFinite(value)) return "—";
  if (def.format === "currency") {
    return "$" + Math.round(value).toLocaleString();
  }
  return Math.round(value).toLocaleString();
}
