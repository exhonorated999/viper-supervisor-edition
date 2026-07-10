// ICAC data service — the single seam between the UI and the local store.
// Loads the index from the chosen storage backend, merges newly imported tips
// (deduped), persists, and notifies subscribers. Nothing here touches the LAN.
// ---------------------------------------------------------------------------

import type { CyberTip, IcacIndex, StoredDoc } from "./types";
import { emptyIndex, isVaultEnvelope } from "./types";
import { getIcacStorage } from "./storage/index";
import { vaultState, encryptIndex, decryptEnvelope } from "./crypto/vault";
import { logAudit } from "./audit";

let index: IcacIndex | null = null;
let loading: Promise<IcacIndex> | null = null;
const subs = new Set<() => void>();

function notify() { for (const cb of subs) cb(); }

export function onIcacDataChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Raised by loadIcacIndex when the store is encrypted but the vault is locked. */
export const ICAC_LOCKED = "ICAC_LOCKED";

/** Turn a raw stored document into a plaintext index, decrypting if needed. */
async function materialize(doc: StoredDoc): Promise<IcacIndex> {
  if (isVaultEnvelope(doc)) {
    if (vaultState() !== "unlocked") throw new Error(ICAC_LOCKED);
    return decryptEnvelope(doc);
  }
  return doc ?? emptyIndex();
}

/** Choose the on-disk representation: encrypted envelope when the vault is unlocked. */
async function toStored(ix: IcacIndex): Promise<StoredDoc> {
  const stamped: IcacIndex = { ...ix, updated_at: new Date().toISOString() };
  return vaultState() === "unlocked" ? encryptIndex(stamped) : stamped;
}

/** Load (once) the index from storage. Safe to call repeatedly. */
export async function loadIcacIndex(force = false): Promise<IcacIndex> {
  if (index && !force) return index;
  if (loading && !force) return loading;
  loading = getIcacStorage()
    .readIndex()
    .then((doc) => materialize(doc))
    .then((ix) => { index = ix; return index; })
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
  await getIcacStorage().writeIndex(await toStored(ix));
  notify();
  void logAudit("import", `+${added} new, ${updated} updated (${incoming.length} in batch)`);
  return { added, updated };
}

/** Replace a single tip (e.g. after manual field edits) and persist. */
export async function updateTip(tip: CyberTip): Promise<void> {
  const ix = await loadIcacIndex();
  const i = ix.tips.findIndex((t) => t.id === tip.id);
  if (i >= 0) ix.tips[i] = tip; else ix.tips.push(tip);
  ix.updated_at = new Date().toISOString();
  index = ix;
  await getIcacStorage().writeIndex(await toStored(ix));
  notify();
}

/**
 * Re-serialize the current index to storage under the CURRENT vault state.
 * Used after enabling/disabling/rekeying the vault to migrate the on-disk form
 * (plaintext ⇄ encrypted) without changing any data.
 */
export async function persistCurrent(): Promise<void> {
  const ix = await loadIcacIndex();
  await getIcacStorage().writeIndex(await toStored(ix));
  notify();
}
