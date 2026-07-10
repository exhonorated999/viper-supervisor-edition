# Project V.I.P.E.R. — Supervisor Edition (+ Project Viper integration)

## What this is
Law-enforcement command-level oversight platform that **partially integrates** with the user's
existing **Project Viper** investigator app. "Partially integrate" = **share data over LAN**
(stats, case status, OPS plans). NO case content/evidence/media ever crosses the wire.

## Two repos (Windows, cmd.exe)
1. **Supervisor Edition** — `C:\Users\JUSTI\Workspace\viper_supervisor_edition`
   - Vite + React 18 + TS + Recharts. Dev port 3061 (APP_PORT). Branch: master.
   - **Now DUAL-MODE**: plain web build (`npm run dev` / start.bat) AND Electron desktop shell
     (`npm run desktop` / start-desktop.bat). vite `base:"./"` so dist loads over file://.
   - `npm run dev:all` = LAN node + web. `npm run lan` = node. `npm run dev` = web.
   - **Electron desktop**: `electron/main.cjs` + `electron/preload.cjs` (CJS despite type:module).
     `main` field points at main.cjs. `desktop` script = concurrently lan + vite(APP_PORT=3061) +
     wait-on tcp:3061 + electron (ELECTRON_RENDERER_URL). devDeps added: electron@33, wait-on, cross-env.
2. **Project Viper (investigator)** — `C:\Users\JUSTI\Workspace\VIPER`
   - Electron app v3.9.5. Classic scripts + Tailwind (`viper-*`), data in localStorage.
   - Module pattern: `modules/<name>/<name>-main.js` (+ `registerIpc(ipcMain)`) + `<name>-ui.js`.
     IPC via `electronAPI` (contextBridge). Identity localStorage: `viper_customer_name`,
     `viper_agency`, `viperUserInfo`. Cases: `localStorage.viperCases`. OPS plans per-case. Work on
     branch **feature/supervisor-link**.

## LAN model: PUSH (investigator-initiated). protocol v2 mutual-auth (P-256 ECDSA/ECDH, HKDF-SHA-256,
AES-256-GCM, RFC-7638 thumbprint deviceId, TOFU node pinning). LAN node port 7071. Details unchanged —
crypto contract byte-identical across lan-node/crypto.mjs · src/lan/crypto.ts · VIPER supervisor-link-crypto.js.
Verified: crypto 11/11, E2E 13/13.

## ICAC module (`src/icac/*`) — 7 phases built + IDS tray. 100% LOCAL; only `assign.ts` touches LAN.
- Storage behind adapter seam (FsAccess / IndexedDB), StoredDoc = IcacIndex | VaultEnvelope.
- Phase 6 Export Center: CSV/XLSX(jszip hand-rolled)/JSON/PDF(pdf-lib), local download only.
- Phase 7 Security: PBKDF2(210k)→AES-256-GCM vault (crypto/vault.ts), idb audit log (audit.ts),
  RBAC command/readonly (config.ts). Verified vault 7/7, export 12/12.

### ICAC Data System (IDS) tray — NEW (commit master 8469e78)
- Purpose: connect to IDS (agency cybertip download portal) from inside the app, capture ZIP
  downloads straight into a staging area, then **batch ingest+parse** — skipping the OS Downloads folder.
- **Requires Electron desktop** for the embedded browser (plain browsers block iframing IDS +
  cross-origin autofill + download interception). Web build degrades: "Open IDS in browser" + manual drop.
- Files (`src/icac/ids/`): `config.ts` (URL/username/password/autofill/selectors in PLAIN localStorage
  key `viper.supervisor.icac.ids` — user chose unencrypted, NOT the vault) · `bridge.ts` (typed
  `window.viperIDS` wrapper w/ web fallback) · `staging.ts` (renderer store; Electron ZIPs on disk in
  userData fetched lazily + manual in-memory drops; filesFor→ingestFiles) · `autofill.ts`
  (builds injected script, heuristic field detect + optional selector overrides, no auto-submit unless
  submitSel set) · `webview.d.ts` (JSX `<webview>` typing) · `IdsTray.tsx` (right slide-out: nav
  toolbar + `<webview partition="persist:ids">` + Autofill btn + staging list + "Batch Ingest & Parse")
  · `IdsSettings.tsx` (Settings form, rendered in IcacSettings).
- Electron main (`electron/main.cjs`): `session.fromPartition("persist:ids").on("will-download")` →
  `item.setSavePath()` into `userData/ids-staging/` + `_index.json`, notifies renderer `ids:staged`.
  IPC: ids:list/read/remove/clear/open-external. Preload exposes `viperIDS` via contextBridge.
- Header button "🌐 Connect to IDS" (Icac.tsx, hidden while vault locked). Audit actions added:
  `ids.download`, `ids.ingest`. `allowpopups` set imperatively on webview (TS rejects string attr).
- Verified: tsc+vite build clean (1085 modules), electron@33.4.11 boots & loads app. NOT yet
  click-through-tested against a real live IDS session (autofill selectors may need tuning per portal).

## Prototype caveats
- Single shared LAN node on localhost. TOFU pinning, raw ws:// (app-layer ECDH+pinning). Keys in
  localStorage/userData JSON. OPS plan PDF = one-page summary. IDS creds stored unencrypted (by choice).

## Conventions / safety
- Windows PTY noisy — redirect cmd output to a temp file then `type`. LAN node NOT hot-reload (restart).
- Vite dev + Electron renderer hot-reload. Electron main/preload changes need electron restart.
- Gitignored: lan-node audit/keys/trust, dist-electron, release, scripts/_*.txt. userData ids-staging is
  outside repo. Feature branch for VIPER repo; never push without asking. Don't read/print secrets/keys.
