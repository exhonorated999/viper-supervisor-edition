# Project V.I.P.E.R. — Supervisor Edition (+ Project Viper integration)

## What this is
Law-enforcement command-level oversight platform that **partially integrates** with the user's
existing **Project Viper** investigator app. "Partially integrate" = **share data over LAN**
(stats, case status, OPS plans). NO case content/evidence/media ever crosses the wire.
**App runs LOCAL/offline** (Windows install or USB, all data local). **Distribution + updates =
electron-updater + GitHub Releases** (mirrors VIPER; checked when online). NOT Railway (VIPER's
Railway URLs are for other backends, not the updater). No cloud data storage.

## Two repos (Windows, cmd.exe)
1. **Supervisor Edition** — `C:\Users\JUSTI\Workspace\viper_supervisor_edition`
   - Vite + React 18 + TS + Recharts. Dev port 3061 (APP_PORT). Branch: master. NO git remote yet.
   - **DUAL-MODE**: plain web build (`npm run dev` / start.bat) AND Electron desktop shell
     (`npm run desktop` / start-desktop.bat). vite `base:"./"` so dist loads over file://.
   - **Electron desktop**: `electron/main.cjs` + `electron/preload.cjs` (CJS despite type:module).
     `main`→main.cjs. `desktop` = concurrently lan + vite(APP_PORT=3061) + wait-on tcp:3061 + electron
     (ELECTRON_RENDERER_URL). devDeps: electron@33, wait-on, cross-env, electron-builder. dep: electron-updater@6.
   - **Packaging (electron-builder.yml)**: Windows `nsis` (oneClick:false, perMachine:false,
     allowToChangeInstallationDirectory:true — USB-installable) + `portable` single-exe. UNSIGNED
     (verifyUpdateCodeSignature:false; flip true when a cert exists). Scripts: `npm run dist`
     (nsis+portable), `npm run pack:dir` (unpacked), `npm run release` (dist + `--publish always`).
     Artifact names space-free (VIPER-Supervisor-Edition-Setup/Portable-<v>.exe) so they match latest.yml.
     Files packed = dist + electron + package.json (renderer pre-bundled; main uses builtins → no node_modules).
   - **CRITICAL build quirk**: packaging OUTPUT under `C:\Users\JUSTI\Workspace` fails
     `EPERM rename ...win-unpacked` (OneDrive/EDR locks extracted electron.exe mid-rename). FIX baked
     into scripts: `-c.directories.output=C:/viper-build/release`. Artifacts land in `C:\viper-build\release\`.
   - **Auto-update (commit master 0d3c6a2, mirrors VIPER)**: `electron-updater` lazy-loaded in main
     ONLY when app.isPackaged (dev → IPC returns "dev mode"). autoDownload/autoInstallOnAppQuit false
     (user-driven). IPC: app-version, update-check/download/install; event `update-status`
     (checking/available/up-to-date/downloading/downloaded/error). preload exposes `window.viperUpdate`
     (getVersion/check/download/install/onStatus). Renderer: `src/update/bridge.ts` + `src/UpdatePanel.tsx`
     (Settings→General; web build shows "desktop only"). Feed = GitHub Releases via publish block
     (provider:github, owner:exhonorated999, repo:**viper-supervisor-edition** — MUST be created; releases
     can't share VIPER's repo or latest.yml collides). Publish needs GH_TOKEN. Verified: build clean
     (1087 modules), `npm run dist` emits latest.yml (version+sha512+size) + both installers (~98 MB).
     NOT yet done by user: create the GitHub repo, set remote, run `npm run release` for a live round-trip.
   - **NOT wired**: packaged app does NOT spawn the LAN node (still separate `npm run lan`) — follow-up.
2. **Project Viper (investigator)** — `C:\Users\JUSTI\Workspace\VIPER`
   - Electron v3.9.5. origin=github.com/exhonorated999/project-viper. Classic scripts + Tailwind, localStorage.
   - Updater = electron-updater + GitHub Releases (electron-builder.yml publish provider:github). NSIS+portable+msi,
     SIGNED (verifyUpdateCodeSignature:true). electron-main.js Auto-Update section + settings.html update UI +
     preload electronAPI updateCheck/Download/Install/onUpdateStatus — the pattern Supervisor now mirrors.
   - Module pattern: `modules/<name>/<name>-main.js`(+registerIpc) + `<name>-ui.js`. IPC via electronAPI.
     Identity localStorage: viper_customer_name/viper_agency/viperUserInfo. Cases: localStorage.viperCases.
     Work on branch **feature/supervisor-link**.

## LAN model: PUSH (investigator-initiated). protocol v2 mutual-auth (P-256 ECDSA/ECDH, HKDF-SHA-256,
AES-256-GCM, RFC-7638 thumbprint deviceId, TOFU node pinning). LAN node port 7071. crypto contract
byte-identical across lan-node/crypto.mjs · src/lan/crypto.ts · VIPER supervisor-link-crypto.js. Verified 11/11, E2E 13/13.

## ICAC module (`src/icac/*`) — 7 phases + IDS tray. 100% LOCAL; only `assign.ts` touches LAN.
- Storage behind adapter seam (FsAccess / IndexedDB), StoredDoc = IcacIndex | VaultEnvelope.
- Phase 6 Export Center: CSV/XLSX(jszip)/JSON/PDF(pdf-lib), local download. Phase 7 Security:
  PBKDF2(210k)→AES-256-GCM vault (crypto/vault.ts), idb audit log (audit.ts), RBAC command/readonly.
- **IDS tray (commit 8469e78)**: `src/icac/ids/*` — embedded `<webview partition="persist:ids">` (Electron
  only) pointed at the IDS cybertip portal; autofill creds (PLAIN localStorage key
  `viper.supervisor.icac.ids`); main.cjs will-download → userData/ids-staging + `_index.json`; staging store
  → batch ingest via existing ingestFiles. Header btn "🌐 Connect to IDS". Audit: ids.download/ids.ingest.
  Web build degrades to "Open IDS in browser" + manual drop.

## Prototype caveats
- Single shared LAN node on localhost. TOFU pinning, raw ws:// (app-layer ECDH+pinning). Keys in
  localStorage/userData JSON. OPS plan PDF one-page. IDS creds unencrypted (by choice). Installers unsigned
  (SmartScreen warns; update signature verify off). Update feed needs the GitHub repo created + GH_TOKEN.

## Conventions / safety
- Windows PTY noisy — redirect cmd output to a temp file then `type`. LAN node NOT hot-reload (restart).
- Vite dev + Electron renderer hot-reload. Electron main/preload changes need electron restart.
- Packaging outputs to C:/viper-build/release (sidesteps EPERM under the profile path).
- Gitignored: lan-node audit/keys/trust, dist-electron, release, scripts/_*.txt. userData ids-staging +
  C:\viper-build outside repo. Feature branch for VIPER repo; never push without asking. Don't read/print secrets.