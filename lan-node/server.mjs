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
import { fileURLToPath } from "node:url";
import {
  deriveKey,
  encryptJSON,
  decryptJSON,
  randomHex,
  PBKDF2_ITERATIONS,
} from "./crypto.mjs";
import { buildDataset, liveEventPool } from "./dataset.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.LAN_PORT) || 7071;
const PSK = process.env.LAN_PSK || "VIPER-LAN-PSK-2025";
const SERVER_ID = "VIPER-NODE-01";
const AUDIT_FILE = path.join(__dirname, "audit.log.jsonl");

const data = buildDataset();
const audit = [];

// --- Registry + router state (push model) ----------------------------------
// connections : deviceId -> ws            (every authenticated device)
// pendingQueue: deviceId -> [delivery]    (deliveries for a supervisor that
//                                          was offline; flushed on register)
// deliveries  : deliveryId -> delivery    (canonical record for decisions)
const connections = new Map();
const pendingQueue = new Map();
const deliveries = new Map();
let deliverySeq = 1000;

// --- RBAC ------------------------------------------------------------------
const READS = new Set([
  "get:stats", "get:cases", "get:workload",
  "get:ops:pending", "get:ops:signed", "get:alerts",
  "get:unit", "get:audit", "get:deliveries",
]);
const ROLE_PERMS = {
  supervisor: {
    reads: READS,
    actions: new Set([
      "action:ops:sign", "action:ops:return", "action:case:assign",
      "action:delivery:ack", "action:delivery:decision",
    ]),
    // Explicitly forbidden — supervisors are read-only on case content and
    // cannot author OPS plans. Used to demonstrate RBAC enforcement.
    denied: new Set(["action:case:edit", "action:ops:author"]),
  },
  // Investigator nodes (Project V.I.P.E.R.) initiate delivery. They can see
  // the live supervisor roster and push datasets/OPS plans, but cannot read
  // or act on supervisor-side case content.
  investigator: {
    reads: new Set(["get:unit", "get:roster"]),
    actions: new Set(["action:push"]),
    denied: new Set([
      "action:ops:sign", "action:ops:return", "action:case:assign",
      "get:cases", "get:stats", "get:audit",
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

// --- Wire protocol ---------------------------------------------------------
function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
}

const wss = new WebSocketServer({ port: PORT, maxPayload: 64 * 1024 * 1024 });

wss.on("connection", (ws, req) => {
  ws._authed = false;
  ws._salt = randomHex(16);
  ws._nonce = randomHex(16);
  const peer = req.socket.remoteAddress;

  // Handshake step 1: server -> client HELLO (plaintext: just salt + nonce)
  send(ws, {
    t: "hello",
    serverId: SERVER_ID,
    salt: ws._salt,
    nonce: ws._nonce,
    iterations: PBKDF2_ITERATIONS,
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Handshake step 2: client -> server AUTH (encrypted with PSK-derived key)
    if (msg.t === "auth") {
      const key = deriveKey(PSK, Buffer.from(ws._salt, "hex"));
      let authObj;
      try {
        authObj = decryptJSON(key, msg.iv, msg.data); // throws on wrong PSK
      } catch {
        send(ws, { t: "auth-fail", reason: "BAD_KEY" });
        logAudit({ actor: `unknown@${peer}`, role: "?", action: "AUTH", target: SERVER_ID, result: "DENIED" });
        return ws.close();
      }
      if (authObj.nonce !== ws._nonce) {
        send(ws, { t: "auth-fail", reason: "BAD_NONCE" });
        return ws.close();
      }
      if (!ROLE_PERMS[authObj.role]) {
        send(ws, { t: "auth-fail", reason: "UNKNOWN_ROLE" });
        return ws.close();
      }
      ws._authed = true;
      ws._key = key;
      ws._role = authObj.role;
      ws._actor = `${authObj.name} (${authObj.badge})`;
      // Identity for the registry/router. deviceId uniquely identifies a
      // machine; supervisors are addressed by it in the push picker.
      ws._name = authObj.name;
      ws._badge = authObj.badge;
      ws._unit = authObj.unit || data.unit.name;
      ws._deviceId = authObj.deviceId || `${authObj.name}|${authObj.badge}`;
      ws.role = authObj.role;
      ws.actor = ws._actor;
      // Register the connection (drops any stale socket for the same device).
      connections.set(ws._deviceId, ws);
      send(ws, {
        t: "auth-ok",
        ...encryptJSON(key, {
          sessionId: randomHex(8),
          serverId: SERVER_ID,
          unit: data.unit.name,
          role: authObj.role,
          permissions: {
            reads: [...ROLE_PERMS[authObj.role].reads],
            actions: [...ROLE_PERMS[authObj.role].actions],
            denied: [...ROLE_PERMS[authObj.role].denied],
          },
        }),
      });
      logAudit({ actor: ws._actor, role: ws._role, action: "SESSION_OPEN", target: SERVER_ID, result: "OK" });
      // Supervisor came online: deliver anything queued while it was away.
      if (ws._role === "supervisor") flushPending(ws._deviceId);
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

startLiveEvents();

console.log(`\n  V.I.P.E.R. LAN Node`);
console.log(`  ───────────────────────────────`);
console.log(`  listening   ws://0.0.0.0:${PORT}`);
console.log(`  server id   ${SERVER_ID}`);
console.log(`  encryption  AES-256-GCM (PBKDF2 ${PBKDF2_ITERATIONS} / SHA-256)`);
console.log(`  audit log   ${AUDIT_FILE}`);
console.log(`  live events every 14s\n`);

process.on("SIGINT", () => {
  if (liveTimer) clearInterval(liveTimer);
  process.exit(0);
});
