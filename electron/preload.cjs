// Preload for the Supervisor Edition desktop shell.
//
// Exposes a tiny, typed IDS bridge to the renderer over contextBridge. The
// renderer has NO direct Node/fs access — it can only ask the main process to
// list / read / remove staged CyberTip downloads, and subscribe to new ones.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viperIDS", {
  isElectron: true,

  /** List staged download metadata (no bytes). */
  listStaged: () => ipcRenderer.invoke("ids:list"),

  /** Read a staged file's bytes for ingest. Returns { name, bytes } | null. */
  readStaged: (id) => ipcRenderer.invoke("ids:read", id),

  /** Delete one staged file. */
  removeStaged: (id) => ipcRenderer.invoke("ids:remove", id),

  /** Delete every staged file. */
  clearStaged: () => ipcRenderer.invoke("ids:clear"),

  /** Open a URL in the user's real browser. */
  openExternal: (url) => ipcRenderer.invoke("ids:open-external", url),

  /** Subscribe to newly-captured downloads. Returns an unsubscribe fn. */
  onStaged: (cb) => {
    const handler = (_e, meta) => cb(meta);
    ipcRenderer.on("ids:staged", handler);
    return () => ipcRenderer.removeListener("ids:staged", handler);
  },
});

// Auto-update bridge (mirrors Project VIPER's electronAPI update surface).
contextBridge.exposeInMainWorld("viperUpdate", {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke("app-version"),
  check: () => ipcRenderer.invoke("update-check"),
  download: () => ipcRenderer.invoke("update-download"),
  install: () => ipcRenderer.invoke("update-install"),
  onStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
});
