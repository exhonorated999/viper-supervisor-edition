// ICAC data service — the single seam between the UI and the local store.
// Loads the index from the chosen storage backend, merges newly imported tips
// (deduped), persists, and notifies subscribers. Nothing here touches the LAN.
// ---------------------------------------------------------------------------

import type { CyberTip, IcacIndex, StoredDoc, CloseReason, Warrant } from "./types";
import { emptyIndex, isVaultEnvelope } from "./types";
import { getIcacStorage } from "./storage/index";
import { vaultState, encryptIndex, decryptEnvelope } from "./crypto/vault";
import { idbGet, idbSet, idbDel } from "./storage/idb";
import { logAudit } from "./audit";
import { warrantFs } from "./warrantFs";

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
      // Preserve a supervisor's close-out decision across re-imports so a
      // resent report does not silently reopen a closed tip.
      if (prev.disposition) t.disposition = prev.disposition;
      // Preserve the Wilson warrant linkage across re-imports.
      if (prev.warrant_id) t.warrant_id = prev.warrant_id;
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
 * Bulk close-out: mark the given tip ids closed with a reason (and optional
 * note). Closed tips remain in the store + exports but are hidden from active
 * dashboard views. Returns how many were closed.
 */
export async function closeTips(
  ids: string[],
  d: { reason: CloseReason; note?: string; by: string }
): Promise<number> {
  const ix = await loadIcacIndex();
  const set = new Set(ids);
  const at = new Date().toISOString();
  let n = 0;
  for (const t of ix.tips) {
    if (!set.has(t.id)) continue;
    t.disposition = { state: "closed", reason: d.reason, note: d.note, closedBy: d.by, closedAt: at };
    n++;
  }
  if (n) {
    ix.updated_at = at;
    index = ix;
    await getIcacStorage().writeIndex(await toStored(ix));
    notify();
    void logAudit("tip.close", `${n} tip(s) closed — ${d.reason}${d.note ? ` (${d.note})` : ""}`);
  }
  return n;
}

/** Reopen previously closed tips (clears their disposition). */
export async function reopenTips(ids: string[]): Promise<number> {
  const ix = await loadIcacIndex();
  const set = new Set(ids);
  let n = 0;
  for (const t of ix.tips) {
    if (set.has(t.id) && t.disposition?.state === "closed") {
      t.disposition = { state: "open" };
      n++;
    }
  }
  if (n) {
    ix.updated_at = new Date().toISOString();
    index = ix;
    await getIcacStorage().writeIndex(await toStored(ix));
    notify();
    void logAudit("tip.reopen", `${n} tip(s) reopened`);
  }
  return n;
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

// --- Wilson warrants -------------------------------------------------------
// A judge's authorization to open/review CyberTips. Authored in bulk. Metadata
// lives in the (optionally encrypted) index; the signed PDF bytes live in the
// idb KV blob store keyed `warrant-pdf:<id>`. 100% local — never LAN-sent.

const WARRANT_PDF_PREFIX = "warrant-pdf:";

interface StoredPdf { name: string; type: string; bytes: ArrayBuffer; }

async function persistIndex(ix: IcacIndex): Promise<void> {
  ix.updated_at = new Date().toISOString();
  index = ix;
  await getIcacStorage().writeIndex(await toStored(ix));
  notify();
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** All warrants authored on this machine. */
export function getWarrants(): Warrant[] {
  return index?.warrants ?? [];
}

/** Create a warrant and (optionally) cover the given tip ids. */
export async function createWarrant(
  data: Omit<Warrant, "id" | "covered_tip_ids" | "createdAt"> & { covered_tip_ids?: string[] },
  tipIds: string[] = [],
): Promise<Warrant> {
  const ix = await loadIcacIndex();
  if (!ix.warrants) ix.warrants = [];
  const covered = Array.from(new Set([...(data.covered_tip_ids ?? []), ...tipIds]));
  const warrant: Warrant = {
    ...data,
    id: genId("W"),
    covered_tip_ids: covered,
    createdAt: new Date().toISOString(),
  };
  ix.warrants.push(warrant);
  for (const t of ix.tips) if (covered.includes(t.id)) t.warrant_id = warrant.id;
  await persistIndex(ix);
  void logAudit("warrant.create", `#${warrant.warrant_number || "(no #)"} · ${covered.length} tip(s)`);
  return warrant;
}

/** Attach an existing warrant to more tips (idempotent). */
export async function attachWarrant(tipIds: string[], warrantId: string): Promise<number> {
  const ix = await loadIcacIndex();
  const w = ix.warrants?.find((x) => x.id === warrantId);
  if (!w) return 0;
  const set = new Set(w.covered_tip_ids);
  let n = 0;
  for (const t of ix.tips) {
    if (!tipIds.includes(t.id)) continue;
    if (t.warrant_id !== warrantId) { t.warrant_id = warrantId; n++; }
    set.add(t.id);
  }
  w.covered_tip_ids = [...set];
  await persistIndex(ix);
  if (n) void logAudit("warrant.attach", `#${w.warrant_number || "(no #)"} → ${n} tip(s)`);
  return n;
}

/** Remove the warrant linkage from the given tips (does not delete the warrant). */
export async function detachWarrant(tipIds: string[]): Promise<number> {
  const ix = await loadIcacIndex();
  const set = new Set(tipIds);
  let n = 0;
  for (const t of ix.tips) {
    if (set.has(t.id) && t.warrant_id) {
      const w = ix.warrants?.find((x) => x.id === t.warrant_id);
      if (w) w.covered_tip_ids = w.covered_tip_ids.filter((id) => id !== t.id);
      t.warrant_id = undefined;
      n++;
    }
  }
  if (n) await persistIndex(ix);
  return n;
}

/** Update warrant metadata (not its PDF or coverage). */
export async function updateWarrant(w: Warrant): Promise<void> {
  const ix = await loadIcacIndex();
  const i = ix.warrants?.findIndex((x) => x.id === w.id) ?? -1;
  if (i < 0 || !ix.warrants) return;
  ix.warrants[i] = w;
  await persistIndex(ix);
  void logAudit("warrant.update", `#${w.warrant_number || "(no #)"}`);
}

/** Delete a warrant, clear linkage on covered tips, and drop its signed PDF. */
export async function deleteWarrant(id: string): Promise<void> {
  const ix = await loadIcacIndex();
  const w = ix.warrants?.find((x) => x.id === id);
  if (!w) return;
  for (const t of ix.tips) if (t.warrant_id === id) t.warrant_id = undefined;
  ix.warrants = (ix.warrants ?? []).filter((x) => x.id !== id);
  await persistIndex(ix);
  try { await idbDel(WARRANT_PDF_PREFIX + id); } catch { /* ignore */ }
  try { await warrantFs.remove(id); } catch { /* ignore */ }
  void logAudit("warrant.delete", `#${w.warrant_number || "(no #)"}`);
}

/** Store the signed PDF for a warrant (blob in idb; metadata on the warrant).
 * In the desktop build the PDF is ALSO written to userData/warrant-pdfs as a
 * real file so it can be recalled long after ingest. */
export async function saveWarrantPdf(id: string, file: File): Promise<void> {
  const ix = await loadIcacIndex();
  const w = ix.warrants?.find((x) => x.id === id);
  if (!w) return;
  const bytes = await file.arrayBuffer();
  const rec: StoredPdf = { name: file.name, type: file.type || "application/pdf", bytes };
  await idbSet(WARRANT_PDF_PREFIX + id, rec);
  w.signed_pdf_name = file.name;
  w.signed_pdf_key = WARRANT_PDF_PREFIX + id;
  // Best-effort filesystem copy (desktop only; no-op in the web build).
  try { await warrantFs.save(id, file.name, bytes.slice(0)); } catch { /* ignore */ }
  await persistIndex(ix);
}

/** Load a warrant's signed PDF as a Blob (or null when none stored).
 * Prefers IndexedDB; falls back to the on-disk warrant-pdfs folder (desktop). */
export async function loadWarrantPdf(id: string): Promise<Blob | null> {
  try {
    const rec = await idbGet<StoredPdf>(WARRANT_PDF_PREFIX + id);
    if (rec && rec.bytes) return new Blob([rec.bytes], { type: rec.type || "application/pdf" });
  } catch { /* fall through to disk */ }
  try {
    const disk = await warrantFs.read(id);
    if (disk && disk.bytes) {
      // Copy into a fresh ArrayBuffer-backed view so Blob accepts it cleanly.
      const buf = new Uint8Array(disk.bytes.byteLength);
      buf.set(disk.bytes);
      return new Blob([buf], { type: "application/pdf" });
    }
  } catch { /* ignore */ }
  return null;
}
