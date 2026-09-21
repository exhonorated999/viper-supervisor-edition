// ---------------------------------------------------------------------------
// Report history — every generated report is archived locally so a supervisor
// can re-open or re-download exactly the file they handed to a chief last
// month, even though the underlying case data has since moved on.
//
// Stored in IndexedDB (its own database, independent of the ICAC store) because
// the payloads are binary and localStorage would blow its quota after a handful
// of PDFs. Nothing here syncs anywhere — it is machine-local, same as the rest
// of the app.
// ---------------------------------------------------------------------------

import type { ReportKind } from "./payload";

const DB_NAME = "viper-reports";
const STORE = "reports";
const VERSION = 1;

/** Newest-first cap. Old entries are pruned so the DB cannot grow forever. */
const MAX_ENTRIES = 60;

export type ReportFormat = "pdf" | "html";

export interface ReportRecord {
  id: string;
  kind: ReportKind;
  format: ReportFormat;
  title: string;
  scopeLabel: string;
  filterLabel: string;
  filename: string;
  createdAt: string;
  size: number;
  blob: Blob;
}

/** Everything except the payload — what the history list renders. */
export type ReportMeta = Omit<ReportRecord, "blob">;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function saveReport(
  rec: Omit<ReportRecord, "id" | "createdAt" | "size">
): Promise<ReportMeta> {
  const full: ReportRecord = {
    ...rec,
    id: newId(),
    createdAt: new Date().toISOString(),
    size: rec.blob.size,
  };
  await tx("readwrite", (s) => s.put(full) as unknown as IDBRequest<IDBValidKey>);
  void prune();
  const { blob: _blob, ...meta } = full;
  return meta;
}

/** History list, newest first. Blobs are dropped — call getReport for those. */
export async function listReports(): Promise<ReportMeta[]> {
  try {
    const all = await tx<ReportRecord[]>("readonly", (s) => s.getAll() as IDBRequest<ReportRecord[]>);
    return all
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getReport(id: string): Promise<ReportRecord | undefined> {
  try {
    return await tx<ReportRecord | undefined>(
      "readonly",
      (s) => s.get(id) as IDBRequest<ReportRecord | undefined>
    );
  } catch {
    return undefined;
  }
}

export async function deleteReport(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

export async function clearReports(): Promise<void> {
  await tx("readwrite", (s) => s.clear() as unknown as IDBRequest<undefined>);
}

/** Drop the oldest entries once the archive exceeds MAX_ENTRIES. */
async function prune(): Promise<void> {
  try {
    const all = await listReports();
    if (all.length <= MAX_ENTRIES) return;
    for (const old of all.slice(MAX_ENTRIES)) await deleteReport(old.id);
  } catch {
    /* pruning is best-effort */
  }
}

/** Push a blob to the user's disk under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open an archived report in a new tab/window (HTML) or viewer (PDF). */
export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
