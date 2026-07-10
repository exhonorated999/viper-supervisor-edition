// Storage adapter seam. The UI talks only to `getIcacStorage()`, so swapping the
// backend (File System Access now, Electron `fs` later) is a drop-in change.
// ---------------------------------------------------------------------------

import type { IcacIndex } from "../types";
import { fsAccessStorage, fsAccessSupported } from "./fsaccess";
import { indexedDbStorage } from "./indexeddb";

export interface IcacStorage {
  kind: "fsaccess" | "indexeddb" | "electron";
  /** Whether this backend can run in the current environment. */
  isAvailable(): boolean;
  /** Sync display label of the chosen location (or null). */
  currentLocation(): string | null;
  /** Whether a usable location/handle has been selected. */
  hasLocation(): Promise<boolean>;
  /** Open the OS picker (or confirm the fallback) and return the label. */
  chooseLocation(): Promise<string>;
  /** Forget the chosen location. */
  clearLocation(): Promise<void>;
  readIndex(): Promise<IcacIndex>;
  writeIndex(ix: IcacIndex): Promise<void>;
}

let cached: IcacStorage | null = null;

/** Pick the best available storage backend for this environment. */
export function getIcacStorage(): IcacStorage {
  if (cached) return cached;
  cached = fsAccessSupported() ? fsAccessStorage : indexedDbStorage;
  return cached;
}

/** Force the in-browser fallback (used when the user declines a folder). */
export function useFallbackStorage(): IcacStorage {
  cached = indexedDbStorage;
  return cached;
}
