# Project V.I.P.E.R. — Supervisor Edition (+ Project Viper integration)

## What this is
Law-enforcement command-level oversight platform that **partially integrates** with the user's
existing **Project Viper** investigator app. "Partially integrate" = **share data over LAN**
(stats, case status, OPS plans). NO case content/evidence/media ever crosses the wire.

## Two repos (Windows, cmd.exe)
1. **Supervisor Edition** — `C:\Users\JUSTI\Workspace\viper_supervisor_edition`
   - Vite + React 18 + TS + Recharts. Dev port 3061 (APP_PORT). Branch: master.
   - `npm run dev:all` = LAN node + web. `npm run lan` = node. `npm run dev` = web.
2. **Project Viper (investigator)** — `C:\Users\JUSTI\Workspace\VIPER`
   - Electron app v3.9.5. Classic scripts + Tailwind (`viper-*`), data in localStorage.
   - Module pattern: `modules/<name>/<name>-main.js` (required + `registerIpc(ipcMain)` in
     electron-main.js) + `modules/<name>/<name>-ui.js` (renderer <script>). IPC via `electronAPI`
     (contextBridge; renderer has NO node/localStorage-from-main access).
   - Identity localStorage: `viper_customer_name`, `viper_agency`, `viperUserInfo`(JSON badgeNumber/
     officerName/agencyName). Cases: `localStorage.viperCases` (array {id,caseNumber,synopsis,status,
     priority,createdAt,lastModified,createdBy,modules}). OPS plans authored per-case in
     `case-detail-with-analytics.html` (`opsPlanData`). Work on branch **feature/supervisor-link**.

## Model: PUSH (investigator-initiated). LAN node = registry + router (NOT a data owner).
- Supervisors self-register on the node using Settings identity; investigators discover the live
  roster, pick one, push addressed deliveries. Supervisor gets notification + Inbox; OPS plans
  Approve/Return route the decision back to the investigator.
- Delivery types: `stats` (snapshot), `caseStatus` (metadata-only digest), `opsPlan` (manifest + PDF).

## Security: protocol v2 (CURRENT) — mutual-auth, forward-secret, per-device trust
RETIRED the shared-PSK-as-key model. Primitives (all P-256 for browser Web Crypto interop):
- Device/node identity = ECDSA P-256 (sigs raw r||s IEEE-P1363, SHA-256). Ephemeral = ECDH P-256.
- Session key = HKDF-SHA-256(ECDH shared, salt=challenge, info="VIPER-LAN-session-v2") → 32B.
- Channel = AES-256-GCM, 12-byte IV, 16-byte tag APPENDED (ct||tag). Fingerprint = RFC 7638 thumbprint (hex).
- **deviceId = "DEV-" + first16(thumbprint(devicePubKey))**. NodeId = "NODE-" + ...
- Handshake: node `hello{nodeId,nodePubJwk,nodeEphJwk,challenge,nodeSig}` (nodeSig over
  nodeProofString) → client verifies node proof + **pins nodeId (TOFU)**, refuses on mismatch →
  client `auth{role,deviceId,devicePubJwk,clientEphJwk,sig,enc{iv,data}}` (sig over deviceProofString;
  enc=identity{name,badge,unit,nonce} under session key) → node verifies deviceId==fingerprint, sig,
  decrypts identity, nonce==challenge → **TOFU-enrolls** in trust store / enforces revoke + key binding
  → `auth-ok{session}`. auth-fail reasons: BAD_DEVICE_ID, BAD_SIGNATURE, BAD_SESSION, BAD_NONCE,
  UNKNOWN_ROLE, DEVICE_REVOKED, KEY_MISMATCH. Wire types: hello/auth/auth-ok/auth-fail/rpc/rpc-res/event.

### Crypto contract (MUST stay byte-identical across 3 impls; verified)
- `lan-node/crypto.mjs` (ESM) · `src/lan/crypto.ts` (browser Web Crypto, `buf()` cast helper,
  generateIdentityKeyPair=ECDSA / generateEphemeralKeyPair=ECDH) ·
  `VIPER/modules/supervisor-link/supervisor-link-crypto.js` (CJS, single generateKeyPair).
- Exports: generateKeyPair (browser splits identity/ephemeral), jwkThumbprint, deviceIdFromJwk,
  signUtf8, verifyUtf8, deriveSessionKey, encryptJSON/decryptJSON, nodeProofString, deviceProofString.
- Node EC keys are algorithm-agnostic (one key signs + ECDH); browser needs algorithm-specific keys —
  JWK {crv,kty,x,y(,d)} interops. Node ECDSA uses dsaEncoding 'ieee-p1363' to match Web Crypto raw 64B.

### LAN node (`lan-node/server.mjs`), port 7071 (LAN_PORT)
- Static node key persisted `node-key.json` (gitignored); NODE_ID printed on boot ("pin this").
- Trust store `trust-store.json` (gitignored): deviceId→{pubJwk,role,name,badge,unit,firstSeen,lastSeen,revoked}.
- connections Map(deviceId→ws), pendingQueue (offline deliveries), deliveries store.
- RBAC: supervisor (reads + ops/case/delivery/trust actions), investigator (get:unit/get:roster, action:push).
- RPCs: get:roster, get:deliveries, get:trust, action:push, action:delivery:ack/decision,
  action:trust:revoke/unrevoke. Events: delivery:new(→sup), delivery:decision(→inv). maxPayload 64MB.

### Supervisor edition app
- `src/lan/devicekey.ts` — ECDSA device key persisted localStorage `viper.supervisor.devicekey`; deviceId=fingerprint.
- `src/lan/client.ts` — v2 handshake; node pin in localStorage `viper.supervisor.nodepin`, URL in
  `viper.supervisor.nodeurl`; ConnState adds "untrusted" (pin/proof/revoke → no auto-retry); setNodeUrl/resetNodePin.
- `src/data/identity.ts` — name/badge/unit only (deviceId now from key). `src/data/service.ts` — adds
  getDeviceId, getNodePin/getNodeUrl/setNodeUrl/resetNodePin, getTrustedDevices/revokeDevice/unrevokeDevice.
- `src/Settings.tsx` — Registered Supervisor + **Secure Link** (device id, node URL, pinned node + Reset Pin)
  + **Trusted Devices** table (revoke/restore). `src/Inbox.tsx`, App.tsx (Inbox nav badge + delivery toast).

### VIPER investigator side (`modules/supervisor-link/`)
- `supervisor-link-main.js` (main) — v2 WS client; device key + node pins persisted in
  `app.getPath('userData')/supervisor-link-identity.json`. IPC: status/discover/push/disconnect/
  reset-pin/build-ops-pdf (pdf-lib one-page OPS summary). Default node ws://127.0.0.1:7071 (env
  VIPER_SUPERVISOR_LAN_URL).
- `supervisor-link-ui.js` (renderer) — `window.SupervisorLink.openPushDialog({mode:'dashboard'|'opsplan',ops})`;
  Secure-link status line (device id, node pin, reset); builds stats/digest from viperCases; clear
  auth-fail messaging (NODE_PIN_MISMATCH/DEVICE_REVOKED/NODE_PROOF_FAILED).
- Buttons: "Push to Supervisor" (index.html dashboard header), "Send for Approval" (case-detail OPS
  toolbar via sendOpsPlanForApproval()). `ws` declared in VIPER package.json (8.20.0). pdf-lib 1.17.1.

## Prototype caveats
- Single shared LAN node on localhost (not true mDNS/per-machine discovery).
- TOFU pinning (no out-of-band fingerprint verification / no CA); raw ws:// (no TLS) — app-layer
  ECDH+pinning chosen instead for LAN. Device/node private keys stored in localStorage / userData JSON.
- OPS plan PDF is a generated one-page SUMMARY (no embedded photos/maps); full export not wired.

## Verified
- Crypto v2 interop 11/11 (node↔viper↔Web Crypto): thumbprint, sign/verify, ECDH+HKDF, AES-GCM.
- v2 E2E 13/13: node proof/pinning, deviceId=fingerprint, roster, FS delivery, decision routing, TOFU
  trust list, RBAC, revoke (kick + DEVICE_REVOKED), BAD_DEVICE_ID, BAD_SIGNATURE. tsc -b + vite build clean (841 modules).

## Conventions / safety
- Windows PTY noisy — redirect cmd output to a temp file then `type`/`del` for clean reads.
- LAN node (`npm run lan`) is NOT a hot-reloader — restart after editing lan-node/* (regenerates nothing;
  node-key.json/trust-store.json persist). Vite dev hot-reloads.
- Gitignored: lan-node/audit.log.jsonl, node-key.json, trust-store.json. VIPER device key lives in userData.
- Don't read/print secrets/keys. Feature branch for production VIPER repo; never push without asking.
