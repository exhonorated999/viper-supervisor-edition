// Renderer-side staging store for IDS captures + manual drops.
//
// Bridges two sources into one list the tray can render and batch-ingest:
//   • Electron: ZIPs the main process captured from the embedded IDS browser
//     (bytes live on disk in userData; fetched lazily at ingest time).
//   • Manual: files the operator drops into the tray (bytes held in memory) —
//     works in both the desktop and plain-web builds.
//
// Batch ingest reads every "staged" item into File objects and hands them to the
// existing local ingest pipeline. Nothing here touches the LAN.
// ---------------------------------------------------------------------------

import { idsBridge, type StagedMeta } from "./bridge";

export type StagedStatus = "staged" | "ingested" | "error";

export interface StagedItem {
  id: string;
  name: string;
  size: number;
  receivedAt: number;
  source: "ids" | "manual";
  status: StagedStatus;
  detail?: string;
}

const items = new Map<string, StagedItem>();
const manualBytes = new Map<string, File>(); // memory bytes for manual/web items
const subs = new Set<() => void>();
let wired = false;
let offBridge: (() => void) | null = null;

function notify() { for (const cb of subs) cb(); }

function fromMeta(m: StagedMeta): StagedItem {
  return {
    id: m.id,
    name: m.name,
    size: m.size,
    receivedAt: m.receivedAt,
    source: "ids",
    status: "staged",
  };
}

/** Begin listening for captures + hydrate any previously-staged files. */
export async function initStaging(): Promise<void> {
  if (wired) return;
  wired = true;
  if (idsBridge.isElectron) {
    offBridge = idsBridge.onStaged((m) => {
      items.set(m.id, fromMeta(m));
      notify();
    });
    try {
      const existing = await idsBridge.listStaged();
      for (const m of existing) if (!items.has(m.id)) items.set(m.id, fromMeta(m));
      notify();
    } catch { /* ignore */ }
  }
}

export function teardownStaging(): void {
  offBridge?.();
  offBridge = null;
  wired = false;
}

export function getStaged(): StagedItem[] {
  return [...items.values()].sort((a, b) => b.receivedAt - a.receivedAt);
}

export function onStagingChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Add operator-selected files (drag-drop or picker) to the staging area. */
export function addManualFiles(files: File[]): number {
  let added = 0;
  for (const f of files) {
    const id = `M-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    items.set(id, {
      id, name: f.name, size: f.size, receivedAt: Date.now(),
      source: "manual", status: "staged",
    });
    manualBytes.set(id, f);
    added++;
  }
  if (added) notify();
  return added;
}

/** Resolve one staged item to a File for ingest (fetches bytes on demand). */
async function toFile(it: StagedItem): Promise<File | null> {
  if (it.source === "manual") {
    return manualBytes.get(it.id) ?? null;
  }
  const res = await idsBridge.readStaged(it.id);
  if (!res) return null;
  // Copy into a fresh ArrayBuffer so the File owns standalone bytes.
  const copy = new Uint8Array(res.bytes.byteLength);
  copy.set(res.bytes);
  return new File([copy], res.name || it.name, { type: "application/zip" });
}

/** Build File[] for the given ids (or all "staged" items when omitted). */
export async function filesFor(ids?: string[]): Promise<{ id: string; file: File }[]> {
  const targets = (ids ?? getStaged().filter((i) => i.status === "staged").map((i) => i.id))
    .map((id) => items.get(id))
    .filter((x): x is StagedItem => !!x);
  const out: { id: string; file: File }[] = [];
  for (const it of targets) {
    const file = await toFile(it);
    if (file) out.push({ id: it.id, file });
    else setStatus(it.id, "error", "bytes unavailable");
  }
  return out;
}

export function setStatus(id: string, status: StagedStatus, detail?: string): void {
  const it = items.get(id);
  if (!it) return;
  items.set(id, { ...it, status, detail });
  notify();
}

export async function remove(id: string): Promise<void> {
  const it = items.get(id);
  if (it?.source === "ids") { try { await idsBridge.removeStaged(id); } catch { /* ignore */ } }
  manualBytes.delete(id);
  items.delete(id);
  notify();
}

/** Remove only items already ingested (tidy-up after a batch run). */
export async function clearIngested(): Promise<void> {
  for (const it of getStaged()) {
    if (it.status === "ingested") await remove(it.id);
  }
}

export async function clearAll(): Promise<void> {
  try { if (idsBridge.isElectron) await idsBridge.clearStaged(); } catch { /* ignore */ }
  items.clear();
  manualBytes.clear();
  notify();
}
