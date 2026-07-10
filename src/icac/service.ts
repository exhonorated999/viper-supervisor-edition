// ICAC data service — the single seam between the UI and the local store.
// Loads the index from the chosen storage backend, merges newly imported tips
// (deduped), persists, and notifies subscribers. Nothing here touches the LAN.
// ---------------------------------------------------------------------------

import type { CyberTip, IcacIndex } from "./types";
import { emptyIndex } from "./types";
import { getIcacStorage } from "./storage/index";

let index: IcacIndex | null = null;
let loading: Promise<IcacIndex> | null = null;
const subs = new Set<() => void>();

function notify() { for (const cb of subs) cb(); }

export function onIcacDataChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Load (once) the index from storage. Safe to call repeatedly. */
export async function loadIcacIndex(force = false): Promise<IcacIndex> {
  if (index && !force) return index;
  if (loading && !force) return loading;
  loading = getIcacStorage()
    .readIndex()
    .then((ix) => { index = ix ?? emptyIndex(); return index; })
    .catch(() => { index = emptyIndex(); return index; })
    .finally(() => { loading = null; });
  return loading;
}

export function getTips(): CyberTip[] {
  return index?.tips ?? [];
}

/** A stable identity for de-duplication across re-imports. */
function tipKey(t: CyberTip): string {
  return (t.cybertip_number && `ct:${t.cybertip_number}`) ||
    `src:${t.source_file}`;
}

/**
 * Merge imported tips into the store (newest wins on duplicate key), persist,
 * and notify. Returns { added, updated } counts.
 */
export async function addTips(incoming: CyberTip[]): Promise<{ added: number; updated: number }> {
  const ix = await loadIcacIndex();
  const byKey = new Map<string, CyberTip>();
  for (const t of ix.tips) byKey.set(tipKey(t), t);

  let added = 0, updated = 0;
  for (const t of incoming) {
    const k = tipKey(t);
    if (byKey.has(k)) {
      // Preserve any assignment already made locally.
      const prev = byKey.get(k)!;
      t.assignment = prev.assignment?.assigned_to ? prev.assignment : t.assignment;
      t.id = prev.id;
      byKey.set(k, t);
      updated++;
    } else {
      byKey.set(k, t);
      added++;
    }
  }
  ix.tips = [...byKey.values()];
  ix.updated_at = new Date().toISOString();
  index = ix;
  await getIcacStorage().writeIndex(ix);
  notify();
  return { added, updated };
}

/** Replace a single tip (e.g. after manual field edits) and persist. */
export async function updateTip(tip: CyberTip): Promise<void> {
  const ix = await loadIcacIndex();
  const i = ix.tips.findIndex((t) => t.id === tip.id);
  if (i >= 0) ix.tips[i] = tip; else ix.tips.push(tip);
  ix.updated_at = new Date().toISOString();
  index = ix;
  await getIcacStorage().writeIndex(ix);
  notify();
}
