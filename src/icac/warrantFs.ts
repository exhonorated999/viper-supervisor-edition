// Typed access to the desktop-shell warrant-PDF store (see electron/preload.cjs).
//
// In the Electron desktop build `window.viperWarrants` persists signed Wilson-
// warrant PDFs as real files under userData/warrant-pdfs, so they can be
// recalled long after ingest. In the plain web build it is undefined and every
// call is a no-op — the IndexedDB copy in service.ts remains the source there.
// ---------------------------------------------------------------------------

export interface WarrantFsMeta {
  id: string;
  name: string;
  savedAt: number;
}

interface ViperWarrants {
  isElectron: true;
  save(id: string, name: string, bytes: ArrayBuffer): Promise<{ id: string; name: string; path: string } | null>;
  read(id: string): Promise<{ name: string; bytes: Uint8Array } | null>;
  list(): Promise<WarrantFsMeta[]>;
  remove(id: string): Promise<boolean>;
}

declare global {
  interface Window {
    viperWarrants?: ViperWarrants;
  }
}

const native = typeof window !== "undefined" ? window.viperWarrants : undefined;

export const warrantFs = {
  isElectron: !!native,
  save: (id: string, name: string, bytes: ArrayBuffer) =>
    native?.save(id, name, bytes) ?? Promise.resolve(null),
  read: (id: string) => native?.read(id) ?? Promise.resolve(null),
  list: () => native?.list() ?? Promise.resolve([] as WarrantFsMeta[]),
  remove: (id: string) => native?.remove(id) ?? Promise.resolve(false),
};
