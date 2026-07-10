// Typed access to the desktop-shell auto-update bridge (electron/preload.cjs).
//
// Mirrors Project VIPER's updater surface: check → download (with progress) →
// install & restart, driven by electron-updater against GitHub Releases. In the
// plain web build `window.viperUpdate` is undefined and everything degrades to a
// "desktop only" message.
// ---------------------------------------------------------------------------

export type UpdateStatus =
  | { status: "checking" }
  | { status: "available"; version: string; releaseDate?: string; releaseNotes?: string }
  | { status: "up-to-date"; version?: string }
  | { status: "downloading"; percent: number; transferred: number; total: number; bytesPerSecond?: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

export interface UpdateResult { success: boolean; error?: string }

interface ViperUpdate {
  isElectron: true;
  getVersion(): Promise<string>;
  check(): Promise<UpdateResult>;
  download(): Promise<UpdateResult>;
  install(): Promise<UpdateResult>;
  onStatus(cb: (data: UpdateStatus) => void): () => void;
}

declare global {
  interface Window { viperUpdate?: ViperUpdate }
}

const native = typeof window !== "undefined" ? window.viperUpdate : undefined;
const WEB = { success: false, error: "Updates are available in the desktop app only." } as const;

export const updateBridge = {
  isElectron: !!native,
  getVersion: () => native?.getVersion() ?? Promise.resolve(""),
  check: () => native?.check() ?? Promise.resolve({ ...WEB }),
  download: () => native?.download() ?? Promise.resolve({ ...WEB }),
  install: () => native?.install() ?? Promise.resolve({ ...WEB }),
  onStatus: (cb: (data: UpdateStatus) => void): (() => void) =>
    native ? native.onStatus(cb) : () => {},
};
