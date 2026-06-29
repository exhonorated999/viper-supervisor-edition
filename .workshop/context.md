# Project V.I.P.E.R. — Supervisor Edition (+ Project Viper integration)

## What this is
A law-enforcement command-level oversight platform that **partially integrates** with the
user's existing **Project Viper** investigator app. "Partially integrate" = **share data over
LAN** (stats, case status, OPS plans) — NO case content/evidence/media ever crosses the wire.

## Two repos (both on Windows, cmd.exe shell)
1. **Supervisor Edition** — `C:\Users\JUSTI\Workspace\viper_supervisor_edition`
   - Vite + React 18 + TypeScript + Recharts. Dev port 3061 (APP_PORT). Branch: master.
   - `npm run dev:all` = LAN node + web. `npm run lan` = node only. `npm run dev` = web only.
2. **Project Viper (investigator)** — `C:\Users\JUSTI\Workspace\VIPER`
   - Mature Electron app (v3.9.5). Classic scripts + Tailwind (`viper-*` classes), data in
     localStorage. Modules pattern: `modules/<name>/<name>-main.js` (required + `registerIpc(ipcMain)`
     in electron-main.js) and `modules/<name>/<name>-ui.js` (renderer, loaded via <script> in
     index.html / case-detail-with-analytics.html). IPC exposed via `electronAPI` in preload.js
     (contextBridge; renderer has NO node access, NO localStorage access from main).
   - Identity in localStorage: `viper_customer_name`, `viper_agency`, `viperUserInfo` (JSON,
     has badgeNumber/officerName/agencyName). Cases in `localStorage.viperCases` (array of
     `{id, caseNumber, synopsis, status, priority, createdAt, lastModified, createdBy, modules}`).
   - OPS plans authored per-case in `case-detail-with-analytics.html` (`opsPlanData`).
   - Work committed on branch **feature/supervisor-link** (NOT merged to its main).

## Architecture: PUSH model (Phase 3, current)
Initiation is on the **investigator** side. The LAN node is a **registry + router** (NOT a data owner).
- Supervisors **self-register** on the LAN node using their **Settings identity** (deviceId/name/unit/badge).
- Investigators **discover** the live supervisor roster, pick one, and **push** addressed deliveries.
- Supervisor gets a **notification** + **Inbox**; OPS plans support **Approve/Return** (decision routed back).
- Three delivery types: `stats` (snapshot), `caseStatus` (digest — metadata rows only, no content),
  `opsPlan` (manifest + generated PDF, the only large artifact).

### LAN node (`viper_supervisor_edition/lan-node/`)
- `server.mjs` — WS server, port 7071 (LAN_PORT), PSK "VIPER-LAN-PSK-2025" (LAN_PSK), id VIPER-NODE-01.
  - `connections` Map(deviceId→ws), `pendingQueue` (offline deliveries), `deliveries` store.
  - RBAC roles: `supervisor` (reads + ops/case/delivery actions) and `investigator` (get:unit, get:roster, action:push).
  - RPCs added: get:roster, get:deliveries, action:push, action:delivery:ack, action:delivery:decision.
  - Events: `delivery:new` (→supervisor), `delivery:decision` (→investigator).
- `crypto.mjs` — AES-256-GCM, PBKDF2(SHA-256, **150000**), 12-byte IV, 16-byte tag APPENDED (ct||tag).

### Crypto contract (MUST stay byte-identical across 3 impls)
- `lan-node/crypto.mjs` (ESM, node) · `src/lan/crypto.ts` (browser Web Crypto, uses `buf()` cast helper)
  · `VIPER/modules/supervisor-link/supervisor-link-crypto.js` (CJS, node, Electron main).
- Handshake: server `hello{salt,nonce,iterations}` → client derives key, sends encrypted
  `auth{role,name,badge,deviceId,unit,nonce}` → `auth-ok{session}`. Wire types: hello/auth/auth-ok/auth-fail/rpc/rpc-res/event.

### Supervisor edition app
- `src/data/identity.ts` — persistent machine identity (localStorage `viper.supervisor.identity`, stable deviceId).
- `src/data/service.ts` — seam; adds getIdentity/updateIdentity, getDeliveries/ackDelivery/decideDelivery.
- `src/lan/client.ts` — LanClient.setIdentity() (reconnects); LiveEvent kinds incl. delivery:new/decision.
- `src/Settings.tsx` (registered user), `src/Inbox.tsx` (deliveries + approve/return), App.tsx (Inbox nav
  with unread badge + global delivery notification toast).

### VIPER investigator side (`modules/supervisor-link/`)
- `supervisor-link-main.js` (main) — WS client as role "investigator"; IPC: supervisor-link:status/
  discover/push/disconnect/build-ops-pdf (pdf-lib one-page OPS summary). Default node ws://127.0.0.1:7071
  (env VIPER_SUPERVISOR_LAN_URL / VIPER_SUPERVISOR_LAN_PSK).
- `supervisor-link-ui.js` (renderer) — `window.SupervisorLink.openPushDialog({mode:'dashboard'|'opsplan',ops})`;
  builds stats snapshot + case digest from `viperCases`; investigator deviceId in localStorage `viper_device_id`.
- Buttons: "Push to Supervisor" (dashboard header, index.html), "Send for Approval" (OPS plan toolbar,
  case-detail-with-analytics.html via `sendOpsPlanForApproval()`).
- `ws` added to VIPER package.json deps (was transitive; 8.20.0 installed). pdf-lib 1.17.1 already present.

## Prototype caveats (be honest about these)
- Single shared LAN node on localhost (not true per-machine network discovery / mDNS).
- Hardcoded PSK shared by both apps; no per-device keys or TLS/cert pinning yet.
- OPS plan PDF is a generated one-page SUMMARY (no embedded photos/maps) — full export pipeline not wired.
- VIPER renderer reads identity/cases from localStorage and passes identity on each IPC call.

## Verified (E2E, 11/11)
Cross-module crypto interop (VIPER CJS ↔ node ESM), roster discovery, live delivery of stats/digest/OPS PDF,
inbox pull, decision routed back to investigator, offline queue, RBAC denial of investigator get:cases.
tsc -b clean; vite build clean (840 modules).

## Conventions / safety
- Windows PTY is noisy — redirect command output to a temp file then `type`/`del` it for clean reads.
- LAN node (`npm run lan`) is NOT a hot-reloader — restart it after editing lan-node/*. Vite dev hot-reloads.
- Don't read/print secrets. Use feature branches for the production VIPER repo; never push without asking.
