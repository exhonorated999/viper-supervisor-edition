// V.I.P.E.R. Supervisor Edition — Electron main process.
//
// Wraps the Vite/React app in a desktop shell so the ICAC module can host a
// real embedded browser (<webview>) pointed at the ICAC Data System (IDS) and
// intercept CyberTip ZIP downloads straight into a local staging area — no
// round-trip through the OS Downloads folder.
//
// LAN invariant: nothing here touches the LAN node. IDS traffic and staged
// files are 100% local to this machine (userData). The captured ZIPs are only
// ever fed to the existing local ingest pipeline.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, session, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const IDS_PARTITION = "persist:ids"; // isolated, persistent session for IDS login
const STAGING_DIRNAME = "ids-staging";
const STAGING_INDEX = "_index.json";

let mainWindow = null;

// --- staging store (on disk, survives restarts) ----------------------------

function stagingDir() {
  const dir = path.join(app.getPath("userData"), STAGING_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath() {
  return path.join(stagingDir(), STAGING_INDEX);
}

function readIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(items) {
  try {
    fs.writeFileSync(indexPath(), JSON.stringify(items, null, 2), "utf8");
  } catch (e) {
    console.error("[ids] failed to write staging index:", e);
  }
}

function sanitize(name) {
  return String(name || "download.zip").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

// --- download interception on the IDS webview session ----------------------

function attachDownloadCapture() {
  const idsSession = session.fromPartition(IDS_PARTITION);
  idsSession.on("will-download", (_event, item) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const name = item.getFilename();
    const savePath = path.join(stagingDir(), `${id}__${sanitize(name)}`);
    item.setSavePath(savePath); // route to staging instead of Downloads

    item.on("done", (_e, state) => {
      if (state !== "completed") {
        console.warn(`[ids] download not completed (${state}): ${name}`);
        return;
      }
      const meta = {
        id,
        name,
        size: item.getTotalBytes() || (fs.existsSync(savePath) ? fs.statSync(savePath).size : 0),
        path: savePath,
        receivedAt: Date.now(),
        source: "ids",
        mime: item.getMimeType() || "",
      };
      const items = readIndex();
      items.push(meta);
      writeIndex(items);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("ids:staged", meta);
      }
    });
  });
}

// --- IPC: staging bridge ---------------------------------------------------

function registerIpc() {
  ipcMain.handle("ids:list", () => readIndex());

  ipcMain.handle("ids:read", (_e, id) => {
    const meta = readIndex().find((m) => m.id === id);
    if (!meta || !fs.existsSync(meta.path)) return null;
    const bytes = fs.readFileSync(meta.path); // Buffer -> Uint8Array in renderer
    return { name: meta.name, bytes };
  });

  ipcMain.handle("ids:remove", (_e, id) => {
    const items = readIndex();
    const meta = items.find((m) => m.id === id);
    if (meta) {
      try { if (fs.existsSync(meta.path)) fs.unlinkSync(meta.path); } catch { /* ignore */ }
    }
    writeIndex(items.filter((m) => m.id !== id));
    return true;
  });

  ipcMain.handle("ids:clear", () => {
    for (const m of readIndex()) {
      try { if (fs.existsSync(m.path)) fs.unlinkSync(m.path); } catch { /* ignore */ }
    }
    writeIndex([]);
    return true;
  });

  ipcMain.handle("ids:open-external", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
}

// --- window ----------------------------------------------------------------

function resolveRendererUrl() {
  // Dev: point at the running Vite server. Prod: load the built bundle.
  const devUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
  return devUrl || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0d1117",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enable <webview> for the embedded IDS browser
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const devUrl = resolveRendererUrl();
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  attachDownloadCapture();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
