// ICAC Phase 5 — assignment-loop E2E harness.
//
// Spawns the real LAN node on a throwaway port with temp key/trust files
// (so the production trust store is untouched), connects a supervisor and an
// investigator over the actual v2 handshake, then drives the full loop:
//
//   supervisor  get:investigators        -> sees the investigator online
//   supervisor  action:icac:assign       -> node routes icac:assign:new
//   investigator receives icac:assign:new (cybertip number only, no PII)
//   investigator action:icac:ack         -> node routes icac:assign:ack
//   supervisor  receives icac:assign:ack
//   both        get:icac:assignments     -> record shows "acknowledged"
//   RBAC: investigator action:icac:assign -> RBAC_DENIED
//
// Run:  npx tsx scripts\icac-assign-check.mts
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { WebSocket } from "ws";
import {
  generateKeyPair, jwkThumbprint, deviceIdFromJwk, signUtf8, verifyUtf8,
  deriveSessionKey, encryptJSON, decryptJSON, nodeProofString, deviceProofString,
} from "../lan-node/crypto.mjs";

const PORT = 7191;
const URL = `ws://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icac-e2e-"));
const KEY_FILE = path.join(tmp, "node-key.json");
const TRUST_FILE = path.join(tmp, "trust-store.json");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  XX  ${name}${extra ? "  — " + extra : ""}`); }
}

// --- minimal v2 client ------------------------------------------------------
class Client {
  ws!: WebSocket;
  key: Buffer | null = null;
  seq = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  events: any[] = [];
  eventWaiters: Array<{ kind: string; resolve: (v: any) => void }> = [];
  session: any = null;
  constructor(public role: string, public ident: { name: string; badge: string; unit: string }) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dev = generateKeyPair();
      const deviceId = deviceIdFromJwk(dev.publicJwk, "DEV");
      this.ws = new WebSocket(URL, { maxPayload: 64 * 1024 * 1024 });
      this.ws.on("message", (raw: Buffer) => {
        let msg: any; try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.t === "hello") {
          const nodeEphThumb = jwkThumbprint(msg.nodeEphJwk);
          const nodeOk = verifyUtf8(msg.nodePubJwk, nodeProofString(msg.challenge, nodeEphThumb), msg.nodeSig);
          if (!nodeOk) return reject(new Error("NODE_PROOF_FAILED"));
          const eph = generateKeyPair();
          const clientEphThumb = jwkThumbprint(eph.publicJwk);
          const proof = deviceProofString(msg.challenge, nodeEphThumb, clientEphThumb, deviceId, this.role);
          const sig = signUtf8(dev.privateJwk, proof);
          this.key = deriveSessionKey(eph.privateJwk, msg.nodeEphJwk, msg.challenge);
          const enc = encryptJSON(this.key, { ...this.ident, nonce: msg.challenge });
          this.ws.send(JSON.stringify({ t: "auth", v: 2, role: this.role, deviceId, devicePubJwk: dev.publicJwk, clientEphJwk: eph.publicJwk, sig, enc }));
          return;
        }
        if (msg.t === "auth-ok") { this.session = decryptJSON(this.key!, msg.iv, msg.data); resolve(); return; }
        if (msg.t === "auth-fail") { reject(new Error("AUTH_FAIL:" + msg.reason)); return; }
        if (!this.key) return;
        if (msg.t === "rpc-res") {
          const res = decryptJSON<any>(this.key, msg.iv, msg.data);
          const p = this.pending.get(res.id); if (!p) return;
          this.pending.delete(res.id);
          res.ok ? p.resolve(res.result) : p.reject(new Error(res.error || "RPC_ERROR"));
          return;
        }
        if (msg.t === "event") {
          const e = decryptJSON<any>(this.key, msg.iv, msg.data);
          this.events.push(e);
          const i = this.eventWaiters.findIndex((w) => w.kind === e.kind);
          if (i >= 0) { const w = this.eventWaiters.splice(i, 1)[0]; w.resolve(e); }
          return;
        }
      });
      this.ws.on("error", reject);
    });
  }
  rpc<T = any>(kind: string, payload?: any): Promise<T> {
    const id = ++this.seq;
    const env = encryptJSON(this.key!, { id, kind, payload });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ t: "rpc", ...env }));
    });
  }
  waitEvent(kind: string, timeoutMs = 3000): Promise<any> {
    const existing = this.events.find((e) => e.kind === kind);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("EVENT_TIMEOUT:" + kind)), timeoutMs);
      this.eventWaiters.push({ kind, resolve: (v) => { clearTimeout(t); resolve(v); } });
    });
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

async function main() {
  const proc = spawn(process.execPath, [path.join("lan-node", "server.mjs")], {
    env: { ...process.env, LAN_PORT: String(PORT), LAN_NODE_KEY_FILE: KEY_FILE, LAN_TRUST_FILE: TRUST_FILE },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 900)); // let it bind

  try {
    const sup = new Client("supervisor", { name: "Sgt. Reynolds", badge: "#4521", unit: "ICAC Command" });
    const inv = new Client("investigator", { name: "Det. Alvarez", badge: "#7788", unit: "ICAC Field" });
    await sup.connect();
    await inv.connect();
    check("supervisor handshake", sup.session?.role === "supervisor");
    check("investigator handshake", inv.session?.role === "investigator");

    const roster = await sup.rpc<any[]>("get:investigators");
    check("get:investigators lists the investigator", roster.some((r) => r.name === "Det. Alvarez"), `${roster.length} online`);

    // Supervisor assigns a cybertip (NUMBER ONLY).
    const invId = roster.find((r) => r.name === "Det. Alvarez")!.deviceId;
    const res = await sup.rpc<any>("action:icac:assign", {
      to: invId, cybertipNumber: "CT-99001234", priority: "High", note: "Priority triage",
    });
    check("assign accepted + delivered live", res.delivered === true, res.assignmentId);

    // Investigator receives the assignment event — cybertip number only.
    const ev = await inv.waitEvent("icac:assign:new");
    check("investigator got icac:assign:new", ev.payload.cybertipNumber === "CT-99001234");
    check("assignment carries NO PII fields", !("identifiers" in ev.payload) && !("contraband" in ev.payload) && !("parties" in ev.payload));
    check("assignment carries priority/note", ev.payload.priority === "High" && ev.payload.note === "Priority triage");

    // Investigator acknowledges, reporting the opened case number.
    await inv.rpc("action:icac:ack", { assignmentId: res.assignmentId, caseNumber: "VIPER-2026-0042" });

    // Supervisor receives the ack routed back.
    const ack = await sup.waitEvent("icac:assign:ack");
    check("supervisor got icac:assign:ack", ack.payload.cybertipNumber === "CT-99001234");
    check("ack reports investigator case number", ack.payload.caseNumber === "VIPER-2026-0042");

    // Persisted record reflects acknowledgement for both parties.
    const supList = await sup.rpc<any[]>("get:icac:assignments");
    const invList = await inv.rpc<any[]>("get:icac:assignments");
    check("supervisor sees acknowledged record", supList.some((a) => a.id === res.assignmentId && a.status === "acknowledged"));
    check("investigator sees acknowledged record", invList.some((a) => a.id === res.assignmentId && a.status === "acknowledged"));

    // RBAC: investigator must NOT be able to assign.
    let denied = false;
    try { await inv.rpc("action:icac:assign", { to: invId, cybertipNumber: "CT-1" }); }
    catch (e: any) { denied = /RBAC_DENIED/.test(String(e.message)); }
    check("RBAC: investigator cannot action:icac:assign", denied);

    // Offline delivery: assign to a bogus device -> queued, not live.
    const off = await sup.rpc<any>("action:icac:assign", { to: "DEV-offline-xyz", cybertipNumber: "CT-OFF" });
    check("assign to offline device is queued", off.delivered === false);

    sup.close(); inv.close();
  } finally {
    proc.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }

  console.log(`\n  ${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
