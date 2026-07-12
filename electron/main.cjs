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

const { app, BrowserWindow, session, ipcMain, shell, utilityProcess } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");

// electron-updater: lazy-load, only when packaged. In dev there is no
// app-update.yml and requiring/using it throws — so the update IPC handlers
// degrade gracefully to a "dev mode" response, exactly like Project VIPER.
const DISABLE_AUTOUPDATE = process.env.VIPER_DISABLE_AUTOUPDATE === "1";
let autoUpdater = null;
if (!DISABLE_AUTOUPDATE && app.isPackaged) {
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (e) {
    console.warn("electron-updater not available:", e.message);
  }
}

let isQuitting = false;

const IDS_PARTITION = "persist:ids"; // isolated, persistent session for IDS login
const STAGING_DIRNAME = "ids-staging";
const STAGING_INDEX = "_index.json";
const WARRANT_DIRNAME = "warrant-pdfs"; // signed Wilson-warrant PDFs, preserved for recall
const WARRANT_INDEX = "_index.json";

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

// --- warrant PDF store (on disk, survives restarts) ------------------------
// Signed Wilson-warrant PDFs are preserved as real files under
// userData/warrant-pdfs so they can be recalled long after ingest. Keyed by
// the renderer's warrant id; an _index.json maps id -> { name, path }.

function warrantDir() {
  const dir = path.join(app.getPath("userData"), WARRANT_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function warrantIndexPath() {
  return path.join(warrantDir(), WARRANT_INDEX);
}

function readWarrantIndex() {
  try {
    const arr = JSON.parse(fs.readFileSync(warrantIndexPath(), "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeWarrantIndex(items) {
  try {
    fs.writeFileSync(warrantIndexPath(), JSON.stringify(items, null, 2), "utf8");
  } catch (e) {
    console.error("[warrant] failed to write index:", e);
  }
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

  // --- warrant PDF store IPC ---
  ipcMain.handle("warrant:save", (_e, id, name, bytes) => {
    try {
      if (!id || !bytes) return null;
      const fname = `${sanitize(id)}__${sanitize(name || "warrant.pdf")}`;
      const savePath = path.join(warrantDir(), fname);
      fs.writeFileSync(savePath, Buffer.from(bytes));
      const items = readWarrantIndex().filter((m) => m.id !== id);
      const meta = { id, name: name || "warrant.pdf", path: savePath, savedAt: Date.now() };
      items.push(meta);
      writeWarrantIndex(items);
      return { id: meta.id, name: meta.name, path: meta.path };
    } catch (e) {
      console.error("[warrant] save failed:", e);
      return null;
    }
  });

  ipcMain.handle("warrant:read", (_e, id) => {
    const meta = readWarrantIndex().find((m) => m.id === id);
    if (!meta || !fs.existsSync(meta.path)) return null;
    const bytes = fs.readFileSync(meta.path); // Buffer -> Uint8Array in renderer
    return { name: meta.name, bytes };
  });

  ipcMain.handle("warrant:list", () =>
    readWarrantIndex().map((m) => ({ id: m.id, name: m.name, savedAt: m.savedAt })));

  ipcMain.handle("warrant:remove", (_e, id) => {
    const items = readWarrantIndex();
    const meta = items.find((m) => m.id === id);
    if (meta) { try { if (fs.existsSync(meta.path)) fs.unlinkSync(meta.path); } catch { /* ignore */ } }
    writeWarrantIndex(items.filter((m) => m.id !== id));
    return true;
  });
}

// --- auto-update (electron-updater → GitHub Releases; mirrors VIPER) --------

function sendUpdateStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-status", data);
}

function registerAutoUpdate() {
  // Version lookup works in dev and prod regardless of updater availability.
  ipcMain.handle("app-version", () => app.getVersion());

  if (!autoUpdater) {
    const devMsg = { success: false, error: "Auto-updater unavailable (dev mode)." };
    ipcMain.handle("update-check", () => devMsg);
    ipcMain.handle("update-download", () => devMsg);
    ipcMain.handle("update-install", () => devMsg);
    return;
  }

  autoUpdater.autoDownload = false;          // user clicks "Download"
  autoUpdater.autoInstallOnAppQuit = false;  // user clicks "Install & Restart"
  autoUpdater.allowDowngrade = false;

  app.on("before-quit-for-update", () => { isQuitting = true; });

  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ status: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({
    status: "available", version: info.version, releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes || "",
  }));
  autoUpdater.on("update-not-available", (info) => sendUpdateStatus({ status: "up-to-date", version: info.version }));
  autoUpdater.on("download-progress", (p) => sendUpdateStatus({
    status: "downloading", percent: Math.round(p.percent),
    transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond,
  }));
  autoUpdater.on("update-downloaded", (info) => {
    autoUpdater._downloadedFile = info.downloadedFile || null;
    sendUpdateStatus({ status: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (err) => sendUpdateStatus({ status: "error", message: err.message || "Update check failed." }));

  ipcMain.handle("update-check", async () => {
    try { await autoUpdater.checkForUpdates(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle("update-download", async () => {
    try { await autoUpdater.downloadUpdate(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle("update-install", async () => {
    try {
      isQuitting = true;
      // Native Squirrel/NSIS launcher: spawns installer detached, then quits.
      autoUpdater.quitAndInstall(false, true);
      setTimeout(() => { try { app.exit(0); } catch { /* ignore */ } }, 3000);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// --- Windows Firewall inbound rule (one-time) ------------------------------
// The Supervisor HOSTS the LAN node, so its machine must accept inbound TCP/UDP
// on 7071 from investigator devices. Windows blocks inbound to an unknown exe by
// default, which is why loopback works but a peer laptop is refused. We add a
// single allow rule on first launch (one UAC prompt), then never again. This is
// the "no IT ticket" path for a normal machine; on locked-down/no-admin fleets
// the elevation is declined/blocked and an admin applies the rule via GPO.
const FW_TCP_RULE = "VIPER Supervisor LAN Node (TCP 7071)";
const FW_UDP_RULE = "VIPER Supervisor LAN Node (UDP 7071)";

function firewallRuleExists() {
  return new Promise((resolve) => {
    execFile("netsh", ["advfirewall", "firewall", "show", "rule", `name=${FW_TCP_RULE}`], (err, stdout) => {
      resolve(!err && /Rule Name:/i.test(String(stdout || "")));
    });
  });
}

async function ensureFirewallRule() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  try {
    if (await firewallRuleExists()) return;
    // Elevate once (UAC) and add inbound allow rules for TCP + UDP 7071. Pass the
    // inner script as a Base64 -EncodedCommand to sidestep nested-quote issues.
    const inner = [
      `New-NetFirewallRule -DisplayName '${FW_TCP_RULE}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7071 -Profile Any -ErrorAction SilentlyContinue`,
      `New-NetFirewallRule -DisplayName '${FW_UDP_RULE}' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 7071 -Profile Any -ErrorAction SilentlyContinue`,
    ].join("; ");
    const enc = Buffer.from(inner, "utf16le").toString("base64");
    const outer = `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${enc}'`;
    execFile("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", outer], (err) => {
      if (err) console.warn("[lan] firewall rule not added (elevation declined/blocked):", err.message);
      else console.log("[lan] firewall inbound allow rule ensured for 7071");
    });
  } catch (e) {
    console.warn("[lan] firewall rule setup skipped:", e && e.message);
  }
}

// --- LAN node sidecar ------------------------------------------------------
// The packaged app hosts the V.I.P.E.R. LAN node itself so an operator only has
// to run the installed Supervisor .exe — no separate `npm run lan`, no dev/web
// shell. Investigator devices (Project VIPER) then reach it on ws://<host>:7071
// to push stats/case-status/OPS plans and receive CyberTip assignments.
//
// This ONLY runs when app.isPackaged. In dev the node is started by
// `npm run desktop` (concurrently), so spawning here would double-bind 7071.
// The node is the bundled CJS sidecar (see scripts/build-lan-node.mjs), shipped
// via electron-builder extraResources to resources/lan-node/server.cjs.
let lanProc = null;

function lanNodeStateDir() {
  // Keys / trust / audit live in userData so they persist and stay writable
  // regardless of where the app was installed (incl. a USB drive).
  const dir = path.join(app.getPath("userData"), "lan-node");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function startLanNode() {
  if (!app.isPackaged) return; // dev: concurrently runs `npm run lan`
  if (lanProc) return;

  const scriptPath = path.join(process.resourcesPath, "lan-node", "server.cjs");
  if (!fs.existsSync(scriptPath)) {
    console.error("[lan] sidecar not found at", scriptPath, "— node will not start");
    return;
  }

  const stateDir = lanNodeStateDir();
  const env = {
    ...process.env,
    LAN_NODE_KEY_FILE: path.join(stateDir, "node-key.json"),
    LAN_TRUST_FILE: path.join(stateDir, "trust-store.json"),
    LAN_AUDIT_FILE: path.join(stateDir, "audit.log.jsonl"),
    LAN_DELIVERIES_FILE: path.join(stateDir, "deliveries.json"),
  };

  try {
    lanProc = utilityProcess.fork(scriptPath, [], { env, stdio: "pipe", serviceName: "viper-lan-node" });
    lanProc.stdout?.on("data", (d) => process.stdout.write(`[lan] ${d}`));
    lanProc.stderr?.on("data", (d) => process.stderr.write(`[lan] ${d}`));
    lanProc.on("exit", (code) => {
      // EADDRINUSE (another instance / a dev node already owns 7071) is
      // non-fatal — the app keeps working against whatever node holds the port.
      console.warn(`[lan] sidecar exited (code ${code})`);
      lanProc = null;
    });
    console.log("[lan] sidecar started:", scriptPath);
  } catch (e) {
    console.error("[lan] failed to start sidecar:", e);
    lanProc = null;
  }
}

function stopLanNode() {
  if (!lanProc) return;
  try { lanProc.kill(); } catch { /* ignore */ }
  lanProc = null;
}

// --- window ----------------------------------------------------------------

function resolveRendererUrl() {
  // Dev: point at the running Vite server. Prod: load the built bundle.
  const devUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
  return devUrl || null;
}

function createWindow() {
  // Glowing-V app icon. Lives at build/icon.ico (repo root). In dev this sets
  // the window + taskbar icon; the packaged exe embeds it via electron-builder.
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0d1117",
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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
  ensureFirewallRule();
  startLanNode();
  attachDownloadCapture();
  registerIpc();
  registerAutoUpdate();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => { isQuitting = true; stopLanNode(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
