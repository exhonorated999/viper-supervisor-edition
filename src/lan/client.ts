// ---------------------------------------------------------------------------
// Browser LAN client — protocol v2 (mutual-auth, forward-secret).
//
// Connects to the V.I.P.E.R. LAN node over WebSocket and performs a
// challenge-response handshake:
//   1. node HELLO: { nodeId, nodePubJwk, nodeEphJwk, challenge, nodeSig }
//      — we verify nodeSig against nodePubJwk and PIN the node (TOFU); a
//        changed node key aborts the connection (rogue-node defence).
//   2. we reply AUTH: { role, deviceId, devicePubJwk, clientEphJwk, sig, enc }
//      — sig proves we hold the device private key; enc carries our identity
//        under the ECDH-derived session key (forward secrecy).
//
// Exposes request()/action() (offline-tolerant outbox), onState/onEvent, and
// node-pin / node-URL configuration for the Settings screen.
// ---------------------------------------------------------------------------

import {
  generateEphemeralKeyPair,
  deriveSessionKey,
  signUtf8,
  verifyUtf8,
  jwkThumbprint,
  deviceIdFromJwk,
  nodeProofString,
  deviceProofString,
  encryptJSON,
  decryptJSON,
  type Jwk,
} from "./crypto";
import { getDeviceKey } from "./devicekey";

export type ConnState =
  | "idle"
  | "connecting"
  | "handshaking"
  | "connected"
  | "offline"
  | "untrusted"; // node-pin mismatch / handshake refused

export interface LiveEvent {
  kind:
    | "ops:new"
    | "case:activity"
    | "alert:new"
    | "delivery:new"
    | "delivery:decision";
  payload: any;
}

export interface SessionInfo {
  sessionId: string;
  serverId: string;
  nodeId: string;
  deviceId: string;
  unit: string;
  role: string;
  permissions: { reads: string[]; actions: string[]; denied: string[] };
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedAction {
  kind: string;
  payload: any;
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

type StateListener = (s: ConnState, info: { lastSync: number | null; queued: number; session: SessionInfo | null }) => void;
type EventListener = (e: LiveEvent) => void;

const env = (import.meta as any).env || {};
const URL_KEY = "viper.supervisor.nodeurl";
const PIN_KEY = "viper.supervisor.nodepin";
const DEFAULT_URL = env.VITE_LAN_URL || `ws://${location.hostname}:7071`;

const RPC_TIMEOUT = 8000;
const MAX_BACKOFF = 10000;

function loadUrl(): string {
  try { return localStorage.getItem(URL_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
}
function loadPin(): string | null {
  try { return localStorage.getItem(PIN_KEY); } catch { return null; }
}

export class LanClient {
  private url: string;
  private identity: { role: string; name: string; badge: string; unit?: string };

  private ws: WebSocket | null = null;
  private key: CryptoKey | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private outbox: QueuedAction[] = [];

  private stateListeners = new Set<StateListener>();
  private eventListeners = new Set<EventListener>();

  private _state: ConnState = "idle";
  private _lastSync: number | null = null;
  private _session: SessionInfo | null = null;
  private _untrustedReason: string | null = null;

  private wantConnected = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: { url?: string; identity?: { role: string; name: string; badge: string; unit?: string } }) {
    this.url = opts?.url || loadUrl();
    this.identity = opts?.identity || { role: "supervisor", name: "Sgt. Michael Reynolds", badge: "#4521" };
  }

  /** Update the registered identity (Settings); reconnect to re-register. */
  setIdentity(identity: { role?: string; name: string; badge: string; unit?: string }) {
    this.identity = { role: identity.role || this.identity.role, ...identity };
    if (this.wantConnected) this.ws?.close();
  }

  // --- node pin + url config (Settings) ------------------------------------
  get nodePin(): string | null { return loadPin(); }
  get nodeUrl(): string { return this.url; }
  get untrustedReason(): string | null { return this._untrustedReason; }

  setNodeUrl(url: string) {
    const clean = (url || "").trim() || DEFAULT_URL;
    try { localStorage.setItem(URL_KEY, clean); } catch { /* ignore */ }
    this.url = clean;
    if (this.wantConnected) this.ws?.close(); // reconnect to new endpoint
  }

  /** Forget the pinned node key (re-TOFU on next connect). */
  resetNodePin() {
    try { localStorage.removeItem(PIN_KEY); } catch { /* ignore */ }
    this._untrustedReason = null;
    if (this.wantConnected) { this.backoff = 1000; this.ws?.close(); }
  }

  // --- public API ----------------------------------------------------------
  get state() { return this._state; }
  get lastSync() { return this._lastSync; }
  get session() { return this._session; }
  get queuedCount() { return this.outbox.length; }

  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    cb(this._state, this.snapshot());
    return () => this.stateListeners.delete(cb);
  }
  onEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  connect() {
    this.wantConnected = true;
    if (this._state === "idle" || this._state === "untrusted") this.open();
  }

  waitForConnected(timeoutMs = 2500): Promise<boolean> {
    if (this._state === "connected") return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const off = this.onState((s) => {
        if (s === "connected" && !done) { done = true; clearTimeout(t); off(); resolve(true); }
      });
      const t = setTimeout(() => { if (!done) { done = true; off(); resolve(false); } }, timeoutMs);
    });
  }

  disconnect() {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setState("idle");
  }

  request<T = any>(kind: string, payload?: any): Promise<T> {
    if (this._state !== "connected" || !this.ws || !this.key) {
      return Promise.reject(new Error("LAN_OFFLINE"));
    }
    return this.rpc<T>(kind, payload);
  }

  action<T = any>(kind: string, payload?: any): Promise<T> {
    if (this._state === "connected" && this.ws && this.key) return this.rpc<T>(kind, payload);
    return new Promise<T>((resolve, reject) => {
      this.outbox.push({ kind, payload, resolve, reject });
      this.emitState();
    });
  }

  // --- internals -----------------------------------------------------------
  private snapshot() {
    return { lastSync: this._lastSync, queued: this.outbox.length, session: this._session };
  }
  private setState(s: ConnState) { this._state = s; this.emitState(); }
  private emitState() {
    const snap = this.snapshot();
    for (const cb of this.stateListeners) cb(this._state, snap);
  }

  private open() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.setState("connecting");
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = () => this.setState("handshaking");
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => { /* close handler does the work */ };
    ws.onclose = () => {
      this.key = null;
      this._session = null;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("LAN_DISCONNECTED")); }
      this.pending.clear();
      if (this._state === "untrusted") return; // do not auto-retry a pin mismatch
      if (this.wantConnected) { this.setState("offline"); this.scheduleReconnect(); }
      else this.setState("idle");
    };
  }

  private scheduleReconnect() {
    if (!this.wantConnected) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.open(); }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  private async onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    // Handshake step 1: node HELLO → verify node, pin (TOFU), reply AUTH.
    if (msg.t === "hello") {
      try {
        // (a) node identity proof + pinning
        const nodeProof = nodeProofString(msg.challenge, await jwkThumbprint(msg.nodeEphJwk));
        const nodeOk = await verifyUtf8(msg.nodePubJwk as Jwk, nodeProof, msg.nodeSig);
        const derivedNodeId = await deviceIdFromJwk(msg.nodePubJwk as Jwk, "NODE");
        if (!nodeOk || derivedNodeId !== msg.nodeId) return this.refuse("NODE_PROOF_FAILED");
        const pin = loadPin();
        if (pin && pin !== msg.nodeId) return this.refuse("NODE_PIN_MISMATCH");
        if (!pin) { try { localStorage.setItem(PIN_KEY, msg.nodeId); } catch { /* ignore */ } }

        // (b) our device key + ephemeral ECDH key
        const dev = await getDeviceKey();
        const eph = await generateEphemeralKeyPair();
        const clientEphThumb = await jwkThumbprint(eph.publicJwk);
        const proof = deviceProofString(
          msg.challenge, await jwkThumbprint(msg.nodeEphJwk), clientEphThumb, dev.deviceId, this.identity.role
        );
        const sig = await signUtf8(dev.privateJwk, proof);

        // (c) session key + encrypted identity
        this.key = await deriveSessionKey(eph.privateJwk, msg.nodeEphJwk, msg.challenge);
        const enc = await encryptJSON(this.key, {
          name: this.identity.name, badge: this.identity.badge,
          unit: this.identity.unit, nonce: msg.challenge,
        });
        this.send({
          t: "auth", v: 2, role: this.identity.role,
          deviceId: dev.deviceId, devicePubJwk: dev.publicJwk, clientEphJwk: eph.publicJwk, sig, enc,
        });
      } catch {
        this.ws?.close();
      }
      return;
    }

    if (msg.t === "auth-ok") {
      if (!this.key) return;
      try { this._session = await decryptJSON<SessionInfo>(this.key, msg.iv, msg.data); } catch { /* ignore */ }
      this._untrustedReason = null;
      this.backoff = 1000;
      this._lastSync = Date.now();
      this.setState("connected");
      this.flushOutbox();
      return;
    }

    if (msg.t === "auth-fail") {
      this.refuse(msg.reason || "AUTH_FAILED");
      return;
    }

    if (!this.key) return;

    if (msg.t === "rpc-res") {
      let res: any;
      try { res = await decryptJSON(this.key, msg.iv, msg.data); } catch { return; }
      const p = this.pending.get(res.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(res.id);
      this._lastSync = Date.now();
      this.emitState();
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error || "RPC_ERROR"));
      return;
    }

    if (msg.t === "event") {
      let e: LiveEvent;
      try { e = await decryptJSON<LiveEvent>(this.key, msg.iv, msg.data); } catch { return; }
      this._lastSync = Date.now();
      this.emitState();
      for (const cb of this.eventListeners) cb(e);
      return;
    }
  }

  // A handshake refusal that must NOT auto-retry (bad pin / bad proof / revoked).
  private refuse(reason: string) {
    this._untrustedReason = reason;
    // REVOKED / transient auth failures can retry; pin/proof failures should not.
    const hard = reason === "NODE_PIN_MISMATCH" || reason === "NODE_PROOF_FAILED" || reason === "DEVICE_REVOKED" || reason === "KEY_MISMATCH";
    this.wantConnected = this.wantConnected && !hard;
    this.setState("untrusted");
    this.ws?.close();
  }

  private async rpc<T>(kind: string, payload?: any): Promise<T> {
    const id = ++this.seq;
    const env2 = await encryptJSON(this.key!, { id, kind, payload });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("RPC_TIMEOUT")); }, RPC_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: "rpc", ...env2 });
    });
  }

  private async flushOutbox() {
    if (!this.outbox.length) return;
    const queued = this.outbox.splice(0);
    this.emitState();
    for (const q of queued) {
      try { q.resolve(await this.rpc(q.kind, q.payload)); }
      catch (e) { q.reject(e); }
    }
  }

  private send(obj: unknown) {
    try { this.ws?.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

export const lanClient = new LanClient();
