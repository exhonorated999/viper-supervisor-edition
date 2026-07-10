// Typed access to the desktop-shell IDS bridge (see electron/preload.cjs).
//
// In the Electron desktop build `window.viperIDS` exists and gives us
// download-capture + staging over IPC. In the plain web build it is undefined;
// callers should check `idsBridge.isElectron` and fall back to manual file drops.
// ---------------------------------------------------------------------------

export interface StagedMeta {
  id: string;
  name: string;
  size: number;
  path?: string;
  receivedAt: number;
  source: "ids";
  mime?: string;
}

export interface ReadResult {
  name: string;
  bytes: Uint8Array;
}

interface ViperIDS {
  isElectron: true;
  listStaged(): Promise<StagedMeta[]>;
  readStaged(id: string): Promise<ReadResult | null>;
  removeStaged(id: string): Promise<boolean>;
  clearStaged(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  onStaged(cb: (meta: StagedMeta) => void): () => void;
}

declare global {
  interface Window {
    viperIDS?: ViperIDS;
  }
}

const native = typeof window !== "undefined" ? window.viperIDS : undefined;

export const idsBridge = {
  isElectron: !!native,
  listStaged: () => native?.listStaged() ?? Promise.resolve([]),
  readStaged: (id: string) => native?.readStaged(id) ?? Promise.resolve(null),
  removeStaged: (id: string) => native?.removeStaged(id) ?? Promise.resolve(false),
  clearStaged: () => native?.clearStaged() ?? Promise.resolve(false),
  openExternal: (url: string) => {
    if (native) return native.openExternal(url);
    try { window.open(url, "_blank", "noopener"); } catch { /* ignore */ }
    return Promise.resolve(true);
  },
  onStaged: (cb: (meta: StagedMeta) => void): (() => void) =>
    native ? native.onStaged(cb) : () => {},
};
