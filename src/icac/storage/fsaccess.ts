// File System Access adapter — writes the ICAC DB to a user-chosen folder / USB.
// Chromium only (secure context; localhost qualifies). The directory handle is
// persisted in IndexedDB so the location re-opens next session (with a
// permission re-prompt when the browser requires one).
// ---------------------------------------------------------------------------

import type { IcacIndex } from "../types";
import { emptyIndex } from "../types";
import { idbGet, idbSet, idbDel } from "./idb";
import { setIcacLocationLabel } from "../config";
import type { IcacStorage } from "./index";

const HANDLE_KEY = "dirHandle";
const INDEX_FILE = "icac_index.json";

type DirHandle = any; // FileSystemDirectoryHandle (lib.dom may lack full types)

export function fsAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  if ((await handle.queryPermission?.(opts)) === "granted") return true;
  return (await handle.requestPermission?.(opts)) === "granted";
}

async function getHandle(): Promise<DirHandle | null> {
  const h = await idbGet<DirHandle>(HANDLE_KEY);
  return h ?? null;
}

export const fsAccessStorage: IcacStorage = {
  kind: "fsaccess",

  isAvailable() {
    return fsAccessSupported();
  },

  currentLocation() {
    // Label is mirrored in localStorage for synchronous UI reads.
    try { return localStorage.getItem("viper.supervisor.icac.location"); } catch { return null; }
  },

  async hasLocation() {
    return (await getHandle()) != null;
  },

  async chooseLocation() {
    const handle: DirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    const ok = await ensurePermission(handle);
    if (!ok) throw new Error("Permission to the selected folder was denied.");
    await idbSet(HANDLE_KEY, handle);
    const label = handle.name || "Selected folder";
    setIcacLocationLabel(label);
    return label;
  },

  async clearLocation() {
    await idbDel(HANDLE_KEY);
    setIcacLocationLabel(null);
  },

  async readIndex() {
    const handle = await getHandle();
    if (!handle) return emptyIndex();
    if (!(await ensurePermission(handle))) throw new Error("Folder permission required.");
    try {
      const fh = await handle.getFileHandle(INDEX_FILE, { create: false });
      const file = await fh.getFile();
      const text = await file.text();
      return text ? (JSON.parse(text) as IcacIndex) : emptyIndex();
    } catch {
      // File doesn't exist yet.
      return emptyIndex();
    }
  },

  async writeIndex(ix: IcacIndex) {
    const handle = await getHandle();
    if (!handle) throw new Error("No storage location selected.");
    if (!(await ensurePermission(handle))) throw new Error("Folder permission required.");
    const fh = await handle.getFileHandle(INDEX_FILE, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify({ ...ix, updated_at: new Date().toISOString() }, null, 2));
    await writable.close();
  },
};
