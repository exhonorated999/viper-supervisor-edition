// ---------------------------------------------------------------------------
// V.I.P.E.R. LAN Node  (prototype)
//
// Stands in for an investigator V.I.P.E.R. device / LAN hub. The supervisor
// app connects over WebSocket and performs an AES-256-GCM encrypted handshake
// derived from a pre-shared key (PSK). After the handshake:
//   - all traffic is encrypted (RFP §3.2 AES-256)
//   - every request is checked against role permissions (RBAC, §3.2)
//   - supervisor actions + denials are written to an append-only audit log
//   - the node pushes live events (new OPS plans, case activity, alerts)
//     to demonstrate real-time sync (§3.1)
//
// Run:  npm run lan        (LAN_PORT, LAN_PSK env overrides)
// ---------------------------------------------------------------------------

import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dgram from "node:dgram";
import { fileURLToPath } from "node:url";
import {
  encryptJSON,
  decryptJSON,
  randomHex,
  generateKeyPair,
  jwkThumbprint,
  deviceIdFromJwk,
  signUtf8,
  verifyUtf8,
  deriveSessionKey,
  nodeProofString,
  deviceProofString,
  PROTOCOL_VERSION,
} from "./crypto.mjs";
import { buildDataset, liveEventPool } from "./dataset.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.LAN_PORT) || 7071;
const SERVER_ID = "VIPER-NODE-01";
const AUDIT_FILE = path.join(__dirname, "audit.log.jsonl");
const NODE_KEY_FILE = process.env.LAN_NODE_KEY_FILE || path.join(__dirname, "node-key.json");
const TRUST_FILE = process.env.LAN_TRUST_FILE || path.join(__dirname, "trust-store.json");

const data = buildDataset();
const audit = [];

// --- Node static identity (for client pinning) -----------------------------
// Generated once and persisted. Clients pin nodeId (this key's fingerprint)
// and verify the node's signature on every handshake, defeating rogue nodes.
let nodeKey = loadNodeKey();
const NODE_ID = deviceIdFromJwk(nodeKey.publicJwk, "NODE");

function loadNodeKey() {
  try {
    if (fs.existsSync(NODE_KEY_FILE)) return JSON.parse(fs.readFileSync(NODE_KEY_FILE, "utf8"));
  } catch { /* regenerate below */ }
  const kp = generateKeyPair();
  try { fs.writeFileSync(NODE_KEY_FILE, JSON.stringify(kp), "utf8"); } catch { /* ephemeral */ }
  return kp;
}

// --- Trust store (per-device TOFU + revoke) --------------------------------
// deviceId -> { pubJwk, role, name, badge, unit, firstSeen, lastSeen, revoked }
const trust = loadTrust();

function loadTrust() {
  try {
    if (fs.existsSync(TRUST_FILE)) return new Map(Object.entries(JSON.parse(fs.readFileSync(TRUST_FILE, "utf8"))));
  } catch { /* fresh */ }
  return new Map();
}
function saveTrust() {
  try { fs.writeFileSync(TRUST_FILE, JSON.stringify(Object.fromEntries(trust), null, 2), "utf8"); }
  catch { /* ignore */ }
}

// --- Registry + router state (push model) ----------------------------------
// connections : deviceId -> ws            (every authenticated device)
// pendingQueue: deviceId -> [delivery]    (deliveries for a supervisor that
//                                          was offline; flushed on register)
// deliveries  : deliveryId -> delivery    (canonical record for decisions)
const connections = new Map();
const pendingQueue = new Map();
const deliveries = new Map();
let deliverySeq = 1000;

// --- ICAC assignment loop (supervisor -> investigator) ---------------------
// icacAssignments: assignmentId -> assignment (canonical record for ack).
// icacPending    : deviceId -> [assignment]  (assignments for an investigator
//                  that was offline; flushed when it connects).
// The ONLY case data that ever crosses the wire here is the cybertip NUMBER
// (plus an optional priority/note) — never identifiers or contraband.
const icacAssignments = new Map();
const icacPending = new Map();
let icacSeq = 2000;

// --- RBAC ------------------------------------------------------------------
const READS = new Set([
  "get:stats", "get:cases", "get:workload",
  "get:ops:pending", "get:ops:signed", "get:alerts",
  "get:unit", "get:audit", "get:deliveries", "get:trust",
  // ICAC assignment loop (supervisor -> investigator): supervisor discovers
  // the live investigator roster and reads its own outbound assignments.
  "get:investigators", "get:icac:assignments",
]);
const ROLE_PERMS = {
  supervisor: {
    reads: READS,
    actions: new Set([
      "action:ops:sign", "action:ops:return", "action:case:assign",
      "action:delivery:ack", "action:delivery:decision",
      "action:trust:revoke", "action:trust:unrevoke",
      // Supervisor pushes an ICAC assignment (cybertip NUMBER only).
      "action:icac:assign",
    ]),
    // Explicitly forbidden — supervisors are read-only on case content and
    // cannot author OPS plans. Used to demonstrate RBAC enforcement.
    denied: new Set(["action:case:edit", "action:ops:author"]),
  },
  // Investigator nodes (Project V.I.P.E.R.) initiate delivery. They can see
  // the live supervisor roster and push datasets/OPS plans, but cannot read
  // or act on supervisor-side case content. For the ICAC loop they also
  // RECEIVE assignments and acknowledge them (the reverse direction).
  investigator: {
    reads: new Set(["get:unit", "get:roster", "get:icac:assignments"]),
    actions: new Set(["action:push", "action:icac:ack"]),
    denied: new Set([
      "action:ops:sign", "action:ops:return", "action:case:assign",
      "action:icac:assign",
      "get:cases", "get:stats", "get:audit", "get:trust", "get:investigators",
    ]),
  },
};

function permitted(role, kind) {
  const p = ROLE_PERMS[role];
  if (!p) return false;
  if (p.denied.has(kind)) return false;
  return p.reads.has(kind) || p.actions.has(kind);
}

// --- Audit -----------------------------------------------------------------
function logAudit(entry) {
  const row = { ts: new Date().toISOString(), ...entry };
  audit.unshift(row);
  if (audit.length > 500) audit.pop();
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(row) + "\n");
  } catch {
    /* non-fatal in prototype */
  }
  const tag = row.result === "DENIED" ? "⛔" : "✓";
  console.log(`[audit] ${tag} ${row.actor} :: ${row.action} ${row.target ?? ""} -> ${row.result}`);
}

// --- RPC handlers ----------------------------------------------------------
let opsSeq = 500;
let caseSeq = 500;
let alertSeq = 100;

function handleRpc(conn, kind, payload) {
  switch (kind) {
    case "get:stats": return data.stats;
    case "get:cases": return data.cases;
    case "get:workload": return data.workload;
    case "get:ops:pending": return data.opsPending;
    case "get:ops:signed": return data.opsSigned;
    case "get:alerts": return data.alerts;
    case "get:unit": return data.unit;
    case "get:audit": return audit.slice(0, 100);

    // --- Push model: roster / deliveries -----------------------------------
    case "get:roster": return rosterList();

    // --- ICAC assignment loop (supervisor -> investigator) -----------------
    // Supervisor discovers the live investigator roster to address an
    // assignment. Mirror of get:roster, opposite role.
    case "get:investigators": return investigatorList();

    case "action:icac:assign": {
      // Supervisor assigns a CyberTip to one investigator. Body carries ONLY
      // the cybertip number (+ optional priority/note) — no PII/contraband.
      const cybertipNumber = String(payload.cybertipNumber || "").trim();
      if (!cybertipNumber) throw new Error("MISSING_CYBERTIP_NUMBER");
      const id = `ICAC-${++icacSeq}`;
      const assignment = {
        id,
        cybertipNumber,
        priority: payload.priority || null,
        note: payload.note || "",
        fromName: conn.name, fromBadge: conn.badge, fromDeviceId: conn.deviceId,
        to: payload.to,
        sentAt: new Date().toISOString(),
        status: "sent",
        acknowledgedAt: null,
        caseNumber: null,
      };
      icacAssignments.set(id, assignment);
      logAudit({ actor: conn.actor, role: conn.role, action: "ICAC_ASSIGN", target: cybertipNumber, result: "OK" });
      const online = sendToDevice(payload.to, "icac:assign:new", assignEnvelope(assignment));
      if (!online) {
        const q = icacPending.get(payload.to) || [];
        q.push(assignment);
        icacPending.set(payload.to, q);
      }
      return { assignmentId: id, delivered: online };
    }

    case "action:icac:ack": {
      // Investigator acknowledges an assignment (and optionally reports the
      // case number they opened). Route the ack back to the supervisor.
      const a = icacAssignments.get(payload.assignmentId);
      if (a) {
        a.status = "acknowledged";
        a.acknowledgedAt = new Date().toISOString();
        a.caseNumber = payload.caseNumber || null;
        a.ackDeviceId = conn.deviceId;
      }
      logAudit({ actor: conn.actor, role: conn.role, action: "ICAC_ACK", target: a ? a.cybertipNumber : payload.assignmentId, result: "OK" });
      if (a) {
        sendToDevice(a.fromDeviceId, "icac:assign:ack", {
          id: a.id, cybertipNumber: a.cybertipNumber, caseNumber: a.caseNumber,
          by: conn.name, byBadge: conn.badge, at: a.acknowledgedAt,
        });
      }
      return { ok: true };
    }

    case "get:icac:assignments": {
      // Each side pulls the assignments it participates in (on reconnect).
      const mine = [...icacAssignments.values()].filter(
        (a) => a.to === conn.deviceId || a.fromDeviceId === conn.deviceId
      );
      return mine.sort((x, y) => y.sentAt.localeCompare(x.sentAt));
    }

    // --- Trust administration (supervisor) ---------------------------------
    case "get:trust": {
      return [...trust.entries()].map(([deviceId, t]) => ({
        deviceId, role: t.role, name: t.name, badge: t.badge, unit: t.unit,
        firstSeen: t.firstSeen, lastSeen: t.lastSeen, revoked: !!t.revoked,
        online: connections.has(deviceId),
      })).sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    }

    case "action:trust:revoke": {
      const t = trust.get(payload.deviceId);
      if (t) { t.revoked = true; saveTrust(); }
      logAudit({ actor: conn.actor, role: conn.role, action: "TRUST_REVOKE", target: payload.deviceId, result: "OK" });
      // Kick the device if currently connected.
      const ws = connections.get(payload.deviceId);
      if (ws) { try { ws.close(); } catch { /* ignore */ } }
      return { ok: true };
    }

    case "action:trust:unrevoke": {
      const t = trust.get(payload.deviceId);
      if (t) { t.revoked = false; saveTrust(); }
      logAudit({ actor: conn.actor, role: conn.role, action: "TRUST_UNREVOKE", target: payload.deviceId, result: "OK" });
      return { ok: true };
    }

    case "get:deliveries": {
      // Supervisor pulls its own inbox (e.g. on first paint / reconnect).
      const mine = [...deliveries.values()].filter((d) => d.to === conn.deviceId);
      return mine.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    }

    case "action:push": {
      // Investigator -> supervisor delivery. Body may be a stats snapshot,
      // a case-status digest (metadata only), or an OPS plan + PDF.
      const id = `DLV-${++deliverySeq}`;
      const delivery = {
        id,
        dtype: payload.dtype, // "stats" | "caseStatus" | "opsPlan"
        from: conn.name,
        fromBadge: conn.badge,
        fromDeviceId: conn.deviceId,
        to: payload.to,
        manifest: payload.manifest || {},
        body: payload.body,
        sentAt: new Date().toISOString(),
        status: "unread",
      };
      deliveries.set(id, delivery);
      logAudit({
        actor: conn.actor, role: conn.role,
        action: `PUSH:${payload.dtype}`, target: payload.to, result: "OK",
      });
      const online = sendToDevice(payload.to, "delivery:new", delivery);
      if (online) return { deliveryId: id, delivered: true };
      const q = pendingQueue.get(payload.to) || [];
      q.push(delivery);
      pendingQueue.set(payload.to, q);
      return { deliveryId: id, delivered: false, queued: true };
    }

    case "action:delivery:ack": {
      const d = deliveries.get(payload.deliveryId);
      if (d && d.status === "unread") d.status = "read";
      return { ok: true };
    }

    case "action:delivery:decision": {
      // Supervisor approves / returns a delivered OPS plan. Route the
      // decision back to the originating investigator if still online.
      const d = deliveries.get(payload.deliveryId);
      if (d) {
        d.status = payload.decision; // "approved" | "returned"
        d.decision = {
          by: conn.actor, decision: payload.decision,
          comments: payload.comments || "", at: new Date().toISOString(),
        };
      }
      logAudit({
        actor: conn.actor, role: conn.role,
        action: `DELIVERY_${String(payload.decision).toUpperCase()}`,
        target: payload.deliveryId, result: "OK",
      });
      if (d) {
        sendToDevice(d.fromDeviceId, "delivery:decision", {
          deliveryId: d.id,
          decision: payload.decision,
          comments: payload.comments || "",
          by: conn.actor,
          title: d.manifest?.title || d.dtype,
        });
      }
      return { ok: true };
    }

    case "action:ops:sign": {
      const idx = data.opsPending.findIndex((p) => p.id === payload.planId);
      const base = idx >= 0 ? data.opsPending.splice(idx, 1)[0] : { id: payload.planId };
      const signed = {
        ...base,
        status: "Signed",
        signedBy: payload.signedBy,
        signedAt: new Date().toISOString(),
        comments: payload.comments,
      };
      data.opsSigned.unshift(signed);
      logAudit({ actor: conn.actor, role: conn.role, action: "OPS_SIGN", target: signed.id, result: "OK" });
      return signed;
    }

    case "action:ops:return": {
      const idx = data.opsPending.findIndex((p) => p.id === payload.planId);
      const base = idx >= 0 ? data.opsPending.splice(idx, 1)[0] : { id: payload.planId };
      const returned = { ...base, status: "Returned", comments: payload.comments };
      logAudit({ actor: conn.actor, role: conn.role, action: "OPS_RETURN", target: returned.id, result: "OK" });
      return returned;
    }

    case "action:case:assign": {
      const newCase = {
        caseNumber: payload.caseNumber || `MC-2025-${++caseSeq}`,
        detective: payload.detective,
        state: "Open",
        caseType: payload.caseType || "Unassigned",
        description: payload.description || "",
        openedDate: payload.assignedDate || new Date().toISOString().slice(0, 10),
        ageDays: 0,
        lastActivity: "New Case Assigned",
        lastActivityKind: "New Case",
        lastActivityDate: new Date().toISOString().slice(0, 10),
      };
      data.cases.unshift(newCase);
      logAudit({ actor: conn.actor, role: conn.role, action: "CASE_ASSIGN", target: newCase.caseNumber, result: "OK" });
      // Real-time: the assignment lands on the investigator immediately.
      broadcastEvent("case:activity", newCase);
      return newCase;
    }

    default:
      throw new Error("UNKNOWN_KIND");
  }
}

// --- Live event generator (real-time sync demo) ----------------------------
let liveTimer = null;
function startLiveEvents() {
  let rot = 0;
  liveTimer = setInterval(() => {
    if (![...wss.clients].some((c) => c._authed)) return; // nobody listening
    const pick = rot++ % 3;
    if (pick === 0) {
      const t = liveEventPool.opsPlans[opsSeq % liveEventPool.opsPlans.length];
      const plan = {
        id: `OPS-2025-0${++opsSeq}`,
        title: t.title, detective: t.detective, risk: t.risk,
        submittedDate: new Date().toISOString().slice(0, 10),
        status: "Pending", summary: t.summary,
      };
      data.opsPending.unshift(plan);
      broadcastEvent("ops:new", plan);
    } else if (pick === 1) {
      const t = liveEventPool.activity[caseSeq % liveEventPool.activity.length];
      const c = {
        caseNumber: `MC-2025-0${++caseSeq}`,
        detective: t.detective, state: "Ongoing", caseType: "Field",
        description: "Live field update", openedDate: "2025-04-01", ageDays: 21,
        lastActivity: t.lastActivity, lastActivityKind: t.lastActivityKind,
        lastActivityDate: new Date().toISOString().slice(0, 10),
      };
      data.cases.unshift(c);
      broadcastEvent("case:activity", c);
    } else {
      const alert = {
        id: `al-${++alertSeq}`, severity: "warning", category: "Case Event",
        title: "New significant case event", detail: "Field activity logged via LAN sync",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      data.alerts.unshift(alert);
      broadcastEvent("alert:new", alert);
    }
  }, 14000);
}

function broadcastEvent(kind, payload) {
  for (const c of wss.clients) {
    if (c._authed && c.readyState === 1) {
      send(c, { t: "event", ...encryptJSON(c._key, { kind, payload }) });
    }
  }
}

// --- Router (push model) ---------------------------------------------------
// Send a single encrypted event to one device if it is online.
function sendToDevice(deviceId, kind, payload) {
  const ws = connections.get(deviceId);
  if (ws && ws._authed && ws.readyState === 1) {
    send(ws, { t: "event", ...encryptJSON(ws._key, { kind, payload }) });
    return true;
  }
  return false;
}

// Online supervisors, as seen by an investigator's "Push to Supervisor" picker.
function rosterList() {
  const out = [];
  for (const ws of connections.values()) {
    if (ws._authed && ws._role === "supervisor") {
      out.push({
        deviceId: ws._deviceId,
        name: ws._name,
        badge: ws._badge,
        unit: ws._unit,
      });
    }
  }
  return out;
}

// When a supervisor (re)connects, flush any deliveries that arrived while
// it was offline (RFP §3.1 offline-tolerant).
function flushPending(deviceId) {
  const q = pendingQueue.get(deviceId);
  if (!q || !q.length) return;
  pendingQueue.delete(deviceId);
  for (const delivery of q) sendToDevice(deviceId, "delivery:new", delivery);
}

// Online investigators, as seen by a supervisor's "Assign CyberTip" picker.
function investigatorList() {
  const out = [];
  for (const ws of connections.values()) {
    if (ws._authed && ws._role === "investigator") {
      out.push({
        deviceId: ws._deviceId,
        name: ws._name,
        badge: ws._badge,
        unit: ws._unit,
      });
    }
  }
  return out;
}

// The event payload an investigator receives for a new assignment. Contains
// ONLY the cybertip number (+ priority/note + who sent it) — never PII.
function assignEnvelope(a) {
  return {
    id: a.id,
    cybertipNumber: a.cybertipNumber,
    priority: a.priority,
    note: a.note,
    from: a.fromName,
    fromBadge: a.fromBadge,
    sentAt: a.sentAt,
  };
}

// When an investigator (re)connects, flush any ICAC assignments that arrived
// while it was offline.
function flushIcacPending(deviceId) {
  const q = icacPending.get(deviceId);
  if (!q || !q.length) return;
  icacPending.delete(deviceId);
  for (const a of q) sendToDevice(deviceId, "icac:assign:new", assignEnvelope(a));
}

// --- Wire protocol ---------------------------------------------------------
function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
}

const wss = new WebSocketServer({ port: PORT, maxPayload: 64 * 1024 * 1024 });

wss.on("connection", (ws, req) => {
  ws._authed = false;
  const peer = req.socket.remoteAddress;

  // Per-connection ephemeral ECDH key (forward secrecy) + challenge nonce.
  ws._eph = generateKeyPair();
  ws._ephThumb = jwkThumbprint(ws._eph.publicJwk);
  ws._challenge = randomHex(32);

  // Handshake step 1: server -> client HELLO. Plaintext, but the node signs
  // its ephemeral key with its STATIC identity key so the client can verify
  // it is talking to the pinned node (defeats rogue/MITM nodes).
  send(ws, {
    t: "hello",
    v: PROTOCOL_VERSION,
    nodeId: NODE_ID,
    serverId: SERVER_ID,
    nodePubJwk: nodeKey.publicJwk,
    nodeEphJwk: ws._eph.publicJwk,
    challenge: ws._challenge,
    nodeSig: signUtf8(nodeKey.privateJwk, nodeProofString(ws._challenge, ws._ephThumb)),
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Handshake step 2: client -> server AUTH.
    // { v, role, deviceId, devicePubJwk, clientEphJwk, sig, enc:{iv,data} }
    if (msg.t === "auth") {
      const failClose = (reason) => {
        send(ws, { t: "auth-fail", reason });
        logAudit({ actor: `unknown@${peer}`, role: "?", action: `AUTH:${reason}`, target: NODE_ID, result: "DENIED" });
        return ws.close();
      };

      // 1) deviceId must be the fingerprint of the presented public key.
      let derivedId;
      try { derivedId = deviceIdFromJwk(msg.devicePubJwk, "DEV"); }
      catch { return failClose("BAD_DEVICE_KEY"); }
      if (!msg.deviceId || msg.deviceId !== derivedId) return failClose("BAD_DEVICE_ID");

      // 2) Verify the device's signature over the handshake transcript.
      const clientEphThumb = jwkThumbprint(msg.clientEphJwk);
      const proof = deviceProofString(ws._challenge, ws._ephThumb, clientEphThumb, msg.deviceId, msg.role);
      if (!verifyUtf8(msg.devicePubJwk, proof, msg.sig)) return failClose("BAD_SIGNATURE");

      // 3) Derive the forward-secret session key and decrypt the identity.
      let key, ident;
      try {
        key = deriveSessionKey(ws._eph.privateJwk, msg.clientEphJwk, ws._challenge);
        ident = decryptJSON(key, msg.enc.iv, msg.enc.data);
      } catch { return failClose("BAD_SESSION"); }
      if (ident.nonce !== ws._challenge) return failClose("BAD_NONCE");
      if (!ROLE_PERMS[msg.role]) return failClose("UNKNOWN_ROLE");

      // 4) Trust: TOFU-register new devices; enforce revocation + key binding.
      const existing = trust.get(msg.deviceId);
      if (existing) {
        if (existing.revoked) return failClose("DEVICE_REVOKED");
        if (jwkThumbprint(existing.pubJwk) !== jwkThumbprint(msg.devicePubJwk)) return failClose("KEY_MISMATCH");
        existing.role = msg.role; existing.name = ident.name; existing.badge = ident.badge;
        existing.unit = ident.unit || existing.unit; existing.lastSeen = new Date().toISOString();
      } else {
        trust.set(msg.deviceId, {
          pubJwk: msg.devicePubJwk, role: msg.role,
          name: ident.name, badge: ident.badge, unit: ident.unit || data.unit.name,
          firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), revoked: false,
        });
      }
      saveTrust();

      ws._authed = true;
      ws._key = key;
      ws._role = msg.role;
      ws._name = ident.name;
      ws._badge = ident.badge;
      ws._unit = ident.unit || data.unit.name;
      ws._deviceId = msg.deviceId;
      ws._actor = `${ident.name} (${ident.badge})`;
      ws.role = msg.role;
      ws.actor = ws._actor;
      connections.set(ws._deviceId, ws);

      send(ws, {
        t: "auth-ok",
        ...encryptJSON(key, {
          sessionId: randomHex(8),
          serverId: SERVER_ID,
          nodeId: NODE_ID,
          deviceId: ws._deviceId,
          unit: data.unit.name,
          role: msg.role,
          permissions: {
            reads: [...ROLE_PERMS[msg.role].reads],
            actions: [...ROLE_PERMS[msg.role].actions],
            denied: [...ROLE_PERMS[msg.role].denied],
          },
        }),
      });
      logAudit({ actor: ws._actor, role: ws._role, action: existing ? "SESSION_OPEN" : "DEVICE_ENROLL", target: ws._deviceId, result: "OK" });
      if (ws._role === "supervisor") flushPending(ws._deviceId);
      if (ws._role === "investigator") flushIcacPending(ws._deviceId);
      return;
    }

    // All other traffic must be authenticated + encrypted.
    if (msg.t === "rpc") {
      if (!ws._authed) return ws.close();
      let req2;
      try { req2 = decryptJSON(ws._key, msg.iv, msg.data); }
      catch { return ws.close(); }
      const { id, kind, payload } = req2;

      if (!permitted(ws._role, kind)) {
        logAudit({ actor: ws._actor, role: ws._role, action: kind, target: payload?.planId || payload?.caseNumber || "-", result: "DENIED" });
        return send(ws, { t: "rpc-res", ...encryptJSON(ws._key, { id, ok: false, error: "RBAC_DENIED" }) });
      }
      try {
        const result = handleRpc(
          { actor: ws._actor, role: ws._role, name: ws._name, badge: ws._badge, deviceId: ws._deviceId, unit: ws._unit },
          kind, payload
        );
        send(ws, { t: "rpc-res", ...encryptJSON(ws._key, { id, ok: true, result }) });
      } catch (e) {
        send(ws, { t: "rpc-res", ...encryptJSON(ws._key, { id, ok: false, error: String(e.message || e) }) });
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws._authed) {
      // Only drop the registry entry if it still points at THIS socket
      // (a newer connection for the same device must not be evicted).
      if (connections.get(ws._deviceId) === ws) connections.delete(ws._deviceId);
      logAudit({ actor: ws._actor, role: ws._role, action: "SESSION_CLOSE", target: SERVER_ID, result: "OK" });
    }
  });
});

// Live-event demo generator disabled for the clean build — the supervisor
// receives real data via investigator pushes (Inbox), not synthetic events.
// startLiveEvents();

// --- UDP discovery responder ------------------------------------------------
// Zero-config discovery: investigator machines broadcast a "VIPER_DISCOVER"
// datagram on the LAN; this node replies with its identity + ws port so the
// investigator learns ws://<this-host-ip>:<PORT> without any manual config.
const DISCOVERY_PORT = Number(process.env.LAN_DISCOVERY_PORT) || PORT; // UDP, same number as ws (TCP)
const DISCOVERY_MAGIC = "VIPER_DISCOVER";
let discoverySock = null;

function startDiscovery() {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", (err) => {
    console.log(`  discovery   UDP error: ${err.message} (discovery disabled)`);
    try { sock.close(); } catch { /* ignore */ }
    discoverySock = null;
  });
  sock.on("message", (msg, rinfo) => {
    const text = msg.toString("utf8");
    if (!text.startsWith(DISCOVERY_MAGIC)) return;
    const reply = JSON.stringify({
      magic: "VIPER_NODE",
      nodeId: NODE_ID,
      serverId: SERVER_ID,
      wsPort: PORT,
      proto: PROTOCOL_VERSION,
      name: "V.I.P.E.R. Supervisor Node",
    });
    try { sock.send(reply, rinfo.port, rinfo.address); } catch { /* ignore */ }
  });
  sock.bind(DISCOVERY_PORT, () => {
    try { sock.setBroadcast(true); } catch { /* ignore */ }
    discoverySock = sock;
  });
}
startDiscovery();

function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

console.log(`\n  V.I.P.E.R. LAN Node`);
console.log(`  ───────────────────────────────`);
console.log(`  listening   ws://0.0.0.0:${PORT}`);
console.log(`  server id   ${SERVER_ID}`);
console.log(`  node id     ${NODE_ID}   (pin this on clients)`);
console.log(`  security    ECDSA/ECDH P-256 · HKDF · AES-256-GCM (mutual auth, FS)`);
console.log(`  trust       ${trust.size} device(s) enrolled (TOFU + revoke)`);
console.log(`  audit log   ${AUDIT_FILE}`);
console.log(`  data        clean slate — awaiting investigator pushes`);
console.log(`  discovery   udp/${DISCOVERY_PORT} — replies to "${DISCOVERY_MAGIC}" broadcasts`);
{
  const ips = lanAddresses();
  if (ips.length) {
    console.log(`  reachable   ${ips.map((ip) => `ws://${ip}:${PORT}`).join("  ")}`);
  }
  console.log("");
}

process.on("SIGINT", () => {
  if (liveTimer) clearInterval(liveTimer);
  try { discoverySock && discoverySock.close(); } catch { /* ignore */ }
  process.exit(0);
});
