// Derive dashboard view-models from the local CyberTip store. Pure functions —
// no I/O. This is the ICAC equivalent of src/data/derive.ts: all reshaping lives
// here so the UI stays declarative.
// ---------------------------------------------------------------------------

import type { CyberTip, Provider } from "./types";

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
  const newCount = tips.filter((t) => now - bestTipTime(t) <= 30 * DAY).length;
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

  return { tiles, timeline, heatmap, providers, links, donut, recent, alerts: alerts.slice(0, 12), total };
}
