# Project V.I.P.E.R. — Supervisor Edition (+ Project Viper integration)

## What this is
Law-enforcement command-level oversight platform that **partially integrates** with the user's
existing **Project Viper** investigator app. "Partially integrate" = **share data over LAN**
(stats, case status, OPS plans, ICAC CyberTip assignments). NO case content/evidence/media ever
crosses the wire. **App runs LOCAL/offline** (Windows install or USB, all data local). **Distribution
+ updates = electron-updater + GitHub Releases** (mirrors VIPER; checked when online). No cloud data.

## Two repos (Windows, cmd.exe)
1. **Supervisor Edition** — `C:\Users\JUSTI\Workspace\viper_supervisor_edition`
   - Vite + React 18 + TS + Recharts. Dev port 3061 (APP_PORT). Branch: master. NO git remote yet.
   - **DUAL-MODE**: plain web build (`npm run dev`) AND Electron desktop shell (`npm run desktop`).
     vite `base:"./"` so dist loads over file://. **GOAL: user works SOLELY via the NSIS installer now**
     (stop using the web/dev shortcut — causes confusion).
   - **Electron desktop**: `electron/main.cjs` + `electron/preload.cjs` (CJS despite type:module).
     `main`→main.cjs. devDeps: electron@33, wait-on, cross-env, electron-builder. dep: electron-updater@6, ws@8.
   - **PACKAGED APP SELF-HOSTS THE LAN NODE (commit b5ce309)**: on launch (only when app.isPackaged) main
     spawns the node via `utilityProcess.fork`. Node is bundled to a single dependency-free CJS sidecar by
     `scripts/build-lan-node.mjs` (esbuild → `lan-dist/server.cjs`, ~150KB, inlines `ws`; externals
     bufferutil/utf-8-validate). Shipped via electron-builder `extraResources` → resources/lan-node/server.cjs
     (OUTSIDE asar — native procs can't run from asar). State (key/trust/audit) → `userData/lan-node/*` via
     env `LAN_NODE_KEY_FILE`/`LAN_TRUST_FILE`/`LAN_AUDIT_FILE` (all now overridable in server.mjs; server.mjs
     __dirname is import.meta-guarded so it also runs bundled-CJS). In DEV the node still comes from
     `npm run desktop` (concurrently) — startLanNode() no-ops when !isPackaged (avoids double-bind). Verified:
     installed .exe brings node up on 0.0.0.0:7071 + [::]:7071 + UDP discovery, no `npm run lan`. `build:lan`
     wired into pack:dir/dist/release. Caveat: installed-app node has its OWN key (fresh nodeId in its
     userData) → VIPER must Reset Pin once when switching from a dev node (TOFU).
   - **CRITICAL LAN URL fix (commit 8ce550c)**: renderer `src/lan/client.ts` built DEFAULT_URL from
     `location.hostname`, which is EMPTY over file:// → malformed `ws://:7071` (Supervisor couldn't reach its
     own node in the packaged build). Fixed: `LAN_HOST = location.hostname || "127.0.0.1"` + `normalizeUrl()`
     repairs empty-host/bare inputs and is applied in loadUrl + setNodeUrl. Verified: packaged renderer
     enrolls as supervisor in the node audit log.
   - **PDF ingest fix for Electron (commit 92e3c39)**: pdfjs-dist v6 calls `Uint8Array.prototype.toHex()` /
     `Uint8Array.fromBase64()` (shipped Chromium 140) — ABSENT in Electron 33 (Chromium 130) → ingest crashed
     "a.toHex is not a function" (worked in web build on modern Chrome). Fix: `src/polyfills/uint8-hex-base64.ts`
     (installs TC39 hex/base64 methods on whatever global scope loads it) + `src/icac/import/pdf-worker.ts`
     wrapper that imports the polyfill THEN pdf.worker, fed to pdf.js via `GlobalWorkerOptions.workerPort`
     (Vite `?worker`); polyfill also imported in pdftext.ts main thread. Unzip itself was never broken.
   - **Packaging (electron-builder.yml)**: Windows `nsis` (oneClick:false, perMachine:false,
     allowToChangeInstallationDirectory:true — USB-installable) + `portable`. UNSIGNED
     (verifyUpdateCodeSignature:false). Scripts: `npm run dist` (nsis+portable), `pack:dir`, `release`
     (+`--publish always`). Artifact names space-free (VIPER-Supervisor-Edition-Setup/Portable-<v>.exe) to
     match latest.yml. **CRITICAL build quirk**: output under `C:\Users\JUSTI\Workspace` fails EPERM rename
     (OneDrive/EDR lock) — baked fix `-c.directories.output=C:/viper-build/release`. **Must close the running
     packaged .exe before repackaging** (win-unpacked lock). Installers ~98MB in `C:\viper-build\release\`.
   - **Auto-update (commit 0d3c6a2)**: electron-updater lazy-loaded only when app.isPackaged. autoDownload/
     autoInstallOnAppQuit false. IPC app-version/update-check/download/install; event `update-status`. preload
     `window.viperUpdate`. Renderer `src/update/bridge.ts` + `src/UpdatePanel.tsx` (Settings→General). Feed =
     GitHub Releases (provider:github, owner:exhonorated999, repo:**viper-supervisor-edition** — MUST be
     created; needs GH_TOKEN). NOT yet done by user: create repo, set remote, run `npm run release`.
2. **Project Viper (investigator)** — `C:\Users\JUSTI\Workspace\VIPER`
   - Electron v3.9.x / v4.0.3. origin=github.com/exhonorated999/project-viper. Classic scripts + Tailwind,
     localStorage. Updater = electron-updater + GitHub Releases. Work on branch **feature/supervisor-link**.
   - Module pattern: `modules/<name>/<name>-main.js`(+registerIpc) + `<name>-ui.js`. IPC via electronAPI.
     Identity localStorage: viper_customer_name/viper_agency/viperUserInfo. Cases: localStorage.viperCases;
     per-case timeline events at `timelineEvents_<caseId>` (fields: timestamp,title,lane,category,significance).
   - **Supervisor Link module** (`modules/supervisor-link/*-main.js|-ui.js|-crypto.js`): investigator side of
     the bridge. main registerIpc mounted in electron-main.js (~9067); ui.js loaded in index.html +
     case-detail-with-analytics.html. PUSH (stats/caseStatus/opsPlan) + ICAC assignment RECEIVE.
   - **ICAC receive was implemented (commit b6f2b51) but never RAN — fixed (commits 4202571, c78fb8c)**:
     (1) `getNodeUrl()` was referenced but UNDEFINED (ReferenceError killed the receiver) → now defined
     (reads localStorage `viperSupervisorLinkUrl`, else null→main DEFAULT_URL ws://127.0.0.1:7071).
     (2) receiver was gated on `viperSupervisorLinkEnabled==='true'` which NO UI ever set → flipped to
     OPT-OUT (on by default; only `==='false'` disables). (3) main `listen`/`ensureClient` required name AND
     badge → relaxed to name-only (badge optional). (4) `buildCaseDigest()` now attaches a REDACTED,
     metadata-only `activity` rollup per case (built from timelineEvents_<id>; PII stripped: "— entity"
     suffixes + #numbers removed; anchors a "Case Opened" from createdAt; totals warrants/served/evidence/
     reports/fieldwork + 4-week cadence) — this is what makes mirrored cases CLICKABLE in Supervisor.

## LAN model: PUSH (investigator-initiated). protocol v2 mutual-auth (P-256 ECDSA/ECDH, HKDF-SHA-256,
AES-256-GCM, RFC-7638 thumbprint deviceId, TOFU node pinning). LAN node port 7071 (dual-stack: 127.0.0.1,
localhost/::1, LAN IP; UDP discovery same port). crypto byte-identical across lan-node/crypto.mjs ·
src/lan/crypto.ts · VIPER supervisor-link-crypto.js. Verified 11/11, E2E 13/13 (scripts/icac-assign-check.mts).
Assignment loop: supervisor `action:icac:assign` → node `icac:assign:new` (or queues offline) → investigator
`action:icac:ack` → supervisor `icac:assign:ack`. Supervisor side: src/icac/assign.ts (only ICAC file touching
LAN). Investigator side: supervisor-link inbox (floating bell, "Acknowledge & Launch Case"). RBAC: investigator
cannot assign; supervisor read-only on case content.

## ICAC module (`src/icac/*`) — 7 phases + IDS tray. 100% LOCAL; only `assign.ts` touches LAN.
- Storage behind adapter seam (FsAccess / IndexedDB), StoredDoc = IcacIndex | VaultEnvelope.
- Ingest: `ingestFiles(File[])` → readZip (jszip) → extractPdfText (pdf.js worker, see polyfill fix) →
  parseDocument → addTips. Phase 6 Export (CSV/XLSX/JSON/PDF). Phase 7 Security: PBKDF2(210k)→AES-256-GCM
  vault, idb audit log, RBAC.
- **IDS tray (commit 8469e78)**: `src/icac/ids/*` — embedded `<webview partition="persist:ids">` (Electron
  only) at `https://www.icacdatasystem.com/landing/login`; autofill creds (PLAIN localStorage
  `viper.supervisor.icac.ids`); main.cjs will-download → userData/ids-staging + `_index.json`; staging →
  batch ingest via ingestFiles. Web build degrades to "Open IDS in browser" + manual drop.

## Prototype caveats
- TOFU pinning, raw ws:// (app-layer ECDH+pinning). Keys in localStorage/userData JSON. OPS plan PDF one-page.
  IDS creds unencrypted (by choice). Installers unsigned (SmartScreen warns; update signature verify off).
  Update feed needs the GitHub repo created + GH_TOKEN.

## Conventions / safety
- Windows PTY noisy — redirect cmd output to a temp file then `type`/`findstr`; use `node --check` for JS
  syntax. LAN node NOT hot-reload (restart). Vite dev + Electron renderer hot-reload; main/preload need
  electron restart. Packaging outputs to C:/viper-build/release (EPERM). CLOSE running packaged .exe before
  repackaging. Gitignored: lan-node audit/keys/trust, dist-electron, release, lan-dist, scripts/_*.txt.
  userData ids-staging + lan-node state + C:\viper-build outside repo. VIPER work on feature/supervisor-link;
  never push either repo without asking. Don't read/print secrets.