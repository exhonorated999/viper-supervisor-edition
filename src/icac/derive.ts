// Derive dashboard view-models from the local CyberTip store. Pure functions —
// no I/O. This is the ICAC equivalent of src/data/derive.ts: all reshaping lives
// here so the UI stays declarative.
// ---------------------------------------------------------------------------

import type { CyberTip, Provider } from "./types";
import { isClosed } from "./types";

export interface Tile {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

export interface TimelinePoint { label: string; count: number; sortKey: number; }

export interface HeatCell { type: string; rank: number; value: string; count: number; }
export interface HeatColumn { type: string; cells: { value: string; count: number }[]; }

export interface ProviderRow {
  provider: Provider;
  count: number;
  dataTypes: string;
  status: "Complete" | "Partial";
  lastUpdate: string;
}

export interface LinkRow {
  value: string;
  type: string;
  matches: number;   // how many tips share this identifier
  tipIds: string[];
}

export interface DonutSlice { label: string; code: string; count: number; }

/** A high-priority CyberTip row, ranked by its top NCMEC category severity. */
export interface PriorityRow {
  id: string;
  cybertip_number: string;
  provider: Provider;
  code: string;                 // top NCMEC category code, e.g. "A1"
  label: string;                // human-readable category label
  severity: "High" | "Medium" | "Low";
  fileCount: number;            // contraband media count (metadata only)
  assignedTo: string | null;
  rank: number;                 // sort weight
}

export interface AlertRow {
  id: string;
  kind: "repeat" | "unassigned" | "warrant" | "password" | "contraband";
  text: string;
  at: string;
}

export interface DashboardData {
  tiles: Tile[];
  timeline: TimelinePoint[];
  heatmap: HeatColumn[];
  priorities: PriorityRow[];
  providers: ProviderRow[];
  links: LinkRow[];
  donut: DonutSlice[];
  recent: CyberTip[];
  alerts: AlertRow[];
  total: number;
}

// --- date helpers ----------------------------------------------------------

/** Parse "MM-DD-YYYY HH:MM:SS UTC" (NCMEC) or ISO into epoch ms; NaN if unknown. */
export function parseTipDate(s?: string): number {
  if (!s) return NaN;
  const m = s.match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (m) {
    const [, mo, d, y, hh = "0", mm = "0", ss = "0"] = m;
    return Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

function bestTipTime(t: CyberTip): number {
  const d = parseTipDate(t.date_received);
  if (!Number.isNaN(d)) return d;
  const imp = Date.parse(t.imported_at);
  return Number.isNaN(imp) ? Date.now() : imp;
}

const DAY = 86400000;

// --- category labels (NCMEC/industry buckets) ------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  A1: "CSAM — prepubescent",
  A2: "CSAM — pubescent minor",
  B1: "Child nudity / other",
  B2: "Age-difficult / other",
};

// Severity ranking of NCMEC/industry category codes (A1 most severe). Used to
// rank high-priority CyberTips. Unknown codes rank 0 (lowest).
const CATEGORY_RANK: Record<string, number> = { A1: 4, A2: 3, B1: 2, B2: 1 };
function severityOf(code: string): "High" | "Medium" | "Low" {
  const r = CATEGORY_RANK[code] ?? 0;
  return r >= 3 ? "High" : r >= 1 ? "Medium" : "Low";
}

// --- identifier helpers ----------------------------------------------------

interface IdRef { value: string; type: string; }

function tipIdentifiers(t: CyberTip): IdRef[] {
  const out: IdRef[] = [];
  for (const v of t.identifiers.emails) out.push({ value: v, type: "Email" });
  for (const v of t.identifiers.usernames) out.push({ value: v, type: "Username" });
  for (const v of t.identifiers.phone_numbers) out.push({ value: v, type: "Phone" });
  for (const v of t.identifiers.ip_addresses) out.push({ value: v, type: "IP Address" });
  const d = t.identifiers.device_ids;
  for (const v of [...d.imei, ...d.mac, ...d.gaid, ...d.idfa, ...d.other]) out.push({ value: v, type: "Device ID" });
  return out;
}

function suspectName(t: CyberTip): string | undefined {
  return t.parties.find((p) => p.role === "suspect")?.name ?? t.parties[0]?.name;
}

function needsWarrant(t: CyberTip): boolean {
  // Has network identifiers but no resolved subscriber name → needs legal process.
  const hasIp = t.identifiers.ip_addresses.length > 0;
  return t.source_doc_type === "warrant" || (hasIp && !suspectName(t));
}

// --- main derive -----------------------------------------------------------

export function deriveDashboard(tips: CyberTip[], now = Date.now()): DashboardData {
  const total = tips.length;
  // Closed/dispositioned tips are hidden from every active intelligence view
  // (tiles, priorities, timeline, links, providers, alerts, queue). They stay
  // in the store + exports and are reviewable via the "Show closed" toggle.
  tips = tips.filter((t) => !isClosed(t));

  // Repeat-suspect clustering: any identifier value shared across >1 tip, plus
  // NCMEC-declared Prior CT Reports.
  const idToTips = new Map<string, Set<string>>();
  for (const t of tips) {
    for (const { value, type } of tipIdentifiers(t)) {
      const key = `${type}::${value.toLowerCase()}`;
      if (!idToTips.has(key)) idToTips.set(key, new Set());
      idToTips.get(key)!.add(t.id);
    }
  }
  const repeatTipIds = new Set<string>();
  for (const set of idToTips.values()) {
    if (set.size > 1) for (const id of set) repeatTipIds.add(id);
  }
  for (const t of tips) if (t.prior_reports.length) repeatTipIds.add(t.id);

  // Tiles
  // "New CyberTips" = tips newly IMPORTED into the ICAC store in the last 30
  // days (supervisor mental model), NOT the NCMEC received-date — demo/real
  // reports often carry received-dates from months/years ago, which would make
  // freshly imported tips read as 0. Falls back to received-time if a record
  // somehow lacks a parseable imported_at.
  const importTime = (t: CyberTip): number => {
    const imp = Date.parse(t.imported_at);
    return Number.isNaN(imp) ? bestTipTime(t) : imp;
  };
  const newCount = tips.filter((t) => now - importTime(t) <= 30 * DAY).length;
  const unassigned = tips.filter((t) => !t.assignment.assigned_to).length;
  const withContraband = tips.filter((t) => t.contraband.file_count > 0).length;
  const warrantCount = tips.filter(needsWarrant).length;
  const providerSet = new Set(tips.map((t) => t.provider));

  const tiles: Tile[] = [
    { key: "new", label: "New CyberTips", value: newCount, sub: "Last 30 days" },
    { key: "unassigned", label: "Unassigned Tips", value: unassigned, sub: "Awaiting assignment" },
    { key: "repeat", label: "Repeat Suspect Alerts", value: repeatTipIds.size, sub: "Multiple tip matches" },
    { key: "contraband", label: "Tips With Contraband", value: withContraband, sub: "Contains flagged media" },
    { key: "warrant", label: "Warrant Follow-Up", value: warrantCount, sub: "Requires legal process" },
    { key: "providers", label: "Provider Breakdown", value: providerSet.size, sub: [...providerSet].slice(0, 4).join(" / ") || "—" },
    { key: "total", label: "Total Imported Tips", value: total, sub: "Stored in ICAC DB" },
  ];

  // Timeline — last 60 days, daily buckets.
  const timeline: TimelinePoint[] = [];
  const spanDays = 60;
  const start = now - spanDays * DAY;
  const buckets = new Map<number, number>();
  for (const t of tips) {
    const ts = bestTipTime(t);
    if (ts < start) continue;
    const day = Math.floor(ts / DAY);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  // Weekly aggregation for a cleaner line.
  const weekly = new Map<number, number>();
  for (const [day, n] of buckets) {
    const week = Math.floor(day / 7);
    weekly.set(week, (weekly.get(week) ?? 0) + n);
  }
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  for (const [week, count] of [...weekly.entries()].sort((a, b) => a[0] - b[0])) {
    timeline.push({ label: fmt(week * 7 * DAY), count, sortKey: week });
  }

  // Identifier heatmap — top values per type by cross-tip frequency.
  const TYPES = ["IP Address", "Username", "Email", "Phone", "Device ID"];
  const heatmap: HeatColumn[] = TYPES.map((type) => {
    const freq = new Map<string, number>();
    for (const [key, set] of idToTips) {
      if (!key.startsWith(`${type}::`)) continue;
      freq.set(key.slice(type.length + 2), set.size);
    }
    const cells = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
    return { type, cells };
  });

  // High-priority CyberTips — ranked by their most-severe NCMEC contraband
  // category (A1 > A2 > B1 > B2). Tips with no categorized contraband are
  // excluded (nothing to prioritize on). Ties broken by media count, then most
  // recently imported.
  const priorities: PriorityRow[] = tips
    .map((t): PriorityRow | null => {
      const cats = t.contraband.categories.filter((c) => CATEGORY_RANK[c] != null);
      if (!cats.length) return null;
      const code = cats.reduce((a, b) => (CATEGORY_RANK[b] > CATEGORY_RANK[a] ? b : a));
      return {
        id: t.id,
        cybertip_number: t.cybertip_number || "(no #)",
        provider: t.provider,
        code,
        label: CATEGORY_LABELS[code] ?? code,
        severity: severityOf(code),
        fileCount: t.contraband.file_count,
        assignedTo: t.assignment.assigned_to,
        rank: CATEGORY_RANK[code] ?? 0,
      };
    })
    .filter((r): r is PriorityRow => r !== null)
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.fileCount - a.fileCount ||
        (Date.parse(tips.find((t) => t.id === b.id)!.imported_at) || 0) -
          (Date.parse(tips.find((t) => t.id === a.id)!.imported_at) || 0)
    );

  // Provider intelligence.
  const providers: ProviderRow[] = [...providerSet].map((provider): ProviderRow => {
    const rows = tips.filter((t) => t.provider === provider);
    const last = Math.max(...rows.map(bestTipTime));
    const hasSub = rows.some((t) => suspectName(t));
    const hasIp = rows.some((t) => t.identifiers.ip_addresses.length);
    const types: string[] = [];
    if (hasSub) types.push("Subscriber");
    if (hasIp) types.push("IP Logs");
    if (rows.some((t) => t.contraband.file_count)) types.push("Media");
    return {
      provider,
      count: rows.length,
      dataTypes: types.join(", ") || "Metadata",
      status: hasSub && hasIp ? "Complete" : "Partial",
      lastUpdate: Number.isFinite(last) ? fmt(last) : "—",
    };
  }).sort((a, b) => b.count - a.count);

  // Repeat-suspect linker rows.
  const links: LinkRow[] = [...idToTips.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([key, set]) => {
      const [type, value] = key.split("::");
      return { value, type, matches: set.size, tipIds: [...set] };
    })
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 8);

  // Top contraband categories donut.
  const catFreq = new Map<string, number>();
  for (const t of tips) for (const c of t.contraband.categories) catFreq.set(c, (catFreq.get(c) ?? 0) + 1);
  const donut: DonutSlice[] = [...catFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, label: CATEGORY_LABELS[code] ?? code, count }));

  // Recently imported.
  const recent = [...tips]
    .sort((a, b) => Date.parse(b.imported_at) - Date.parse(a.imported_at))
    .slice(0, 8);

  // Alerts feed.
  const alerts: AlertRow[] = [];
  for (const t of tips) {
    if (repeatTipIds.has(t.id)) {
      alerts.push({ id: `rep-${t.id}`, kind: "repeat", at: t.imported_at,
        text: `Repeat suspect activity on CyberTip ${t.cybertip_number || "(no #)"} (${t.provider})` });
    }
    if (needsWarrant(t)) {
      alerts.push({ id: `war-${t.id}`, kind: "warrant", at: t.imported_at,
        text: `Warrant follow-up needed — CyberTip ${t.cybertip_number || "(no #)"}` });
    }
    if (!t.assignment.assigned_to && t.contraband.file_count > 0) {
      alerts.push({ id: `una-${t.id}`, kind: "unassigned", at: t.imported_at,
        text: `Unassigned tip with contraband — CyberTip ${t.cybertip_number || "(no #)"}` });
    }
  }
  alerts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return { tiles, timeline, heatmap, priorities, providers, links, donut, recent, alerts: alerts.slice(0, 12), total };
}
