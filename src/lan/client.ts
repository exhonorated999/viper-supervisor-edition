// ---------------------------------------------------------------------------
// Browser LAN client.
//
// Connects to the V.I.P.E.R. LAN node over WebSocket, completes the encrypted
// handshake, then exposes:
//   - request(kind, payload)  : encrypted RPC (reads). Rejects when offline so
//                               the caller can fall back to cache.
//   - action(kind, payload)   : encrypted RPC (writes). Queued in an OFFLINE
//                               OUTBOX when disconnected and flushed on
//                               reconnect (RFP §3.1 offline-tolerant).
//   - onState / onEvent       : connection-state + live push subscriptions.
// Auto-reconnects with backoff. All payloads are AES-256-GCM encrypted.
// ---------------------------------------------------------------------------

import { deriveKey, encryptJSON, decryptJSON } from "./crypto";

export type ConnState =
  | "idle"
  | "connecting"
  | "handshaking"
  | "connected"
  | "offline";

export interface LiveEvent {
  kind: "ops:new" | "case:activity" | "alert:new";
  payload: any;
}

export interface SessionInfo {
  sessionId: string;
  serverId: string;
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
const DEFAULT_URL = env.VITE_LAN_URL || `ws://${location.hostname}:7071`;
const DEFAULT_PSK = env.VITE_LAN_PSK || "VIPER-LAN-PSK-2025";

const RPC_TIMEOUT = 8000;
const MAX_BACKOFF = 10000;

export class LanClient {
  private url: string;
  private psk: string;
  private identity: { role: string; name: string; badge: string };

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

  private wantConnected = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: {
    url?: string;
    psk?: string;
    identity?: { role: string; name: string; badge: string };
  }) {
    this.url = opts?.url || DEFAULT_URL;
    this.psk = opts?.psk || DEFAULT_PSK;
    this.identity = opts?.identity || {
      role: "supervisor",
      name: "Sgt. Michael Reynolds",
      badge: "#4521",
    };
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
    if (this._state === "idle") this.open();
  }

  /** Resolve true once connected, or false after timeout. */
  waitForConnected(timeoutMs = 2500): Promise<boolean> {
    if (this._state === "connected") return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const off = this.onState((s) => {
        if (s === "connected" && !done) {
          done = true;
          clearTimeout(t);
          off();
          resolve(true);
        }
      });
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          off();
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  disconnect() {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setState("idle");
  }

  /** Encrypted RPC read. Rejects when not connected (caller uses cache). */
  request<T = any>(kind: string, payload?: any): Promise<T> {
    if (this._state !== "connected" || !this.ws || !this.key) {
      return Promise.reject(new Error("LAN_OFFLINE"));
    }
    return this.rpc<T>(kind, payload);
  }

  /** Encrypted RPC write. Queued offline and flushed on reconnect. */
  action<T = any>(kind: string, payload?: any): Promise<T> {
    if (this._state === "connected" && this.ws && this.key) {
      return this.rpc<T>(kind, payload);
    }
    return new Promise<T>((resolve, reject) => {
      this.outbox.push({ kind, payload, resolve, reject });
      this.emitState();
    });
  }

  // --- internals -----------------------------------------------------------

  private snapshot() {
    return { lastSync: this._lastSync, queued: this.outbox.length, session: this._session };
  }

  private setState(s: ConnState) {
    this._state = s;
    this.emitState();
  }

  private emitState() {
    const snap = this.snapshot();
    for (const cb of this.stateListeners) cb(this._state, snap);
  }

  private open() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;

    ws.onopen = () => this.setState("handshaking");
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => { /* close handler does the work */ };
    ws.onclose = () => {
      this.key = null;
      this._session = null;
      // reject in-flight RPCs
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("LAN_DISCONNECTED"));
      }
      this.pending.clear();
      if (this.wantConnected) {
        this.setState("offline");
        this.scheduleReconnect();
      } else {
        this.setState("idle");
      }
    };
  }

  private scheduleReconnect() {
    if (!this.wantConnected) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  private async onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    // Handshake step 1: server HELLO -> derive key, send AUTH
    if (msg.t === "hello") {
      try {
        this.key = await deriveKey(this.psk, msg.salt, msg.iterations);
        const auth = await encryptJSON(this.key, {
          role: this.identity.role,
          name: this.identity.name,
          badge: this.identity.badge,
          nonce: msg.nonce,
        });
        this.send({ t: "auth", ...auth });
      } catch {
        this.ws?.close();
      }
      return;
    }

    if (msg.t === "auth-ok") {
      if (!this.key) return;
      try {
        this._session = await decryptJSON<SessionInfo>(this.key, msg.iv, msg.data);
      } catch { /* ignore */ }
      this.backoff = 1000; // reset backoff on success
      this._lastSync = Date.now();
      this.setState("connected");
      this.flushOutbox();
      return;
    }

    if (msg.t === "auth-fail") {
      this.wantConnected = false;
      this.ws?.close();
      this.setState("offline");
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

  private async rpc<T>(kind: string, payload?: any): Promise<T> {
    const id = ++this.seq;
    const env2 = await encryptJSON(this.key!, { id, kind, payload });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("RPC_TIMEOUT"));
      }, RPC_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: "rpc", ...env2 });
    });
  }

  private async flushOutbox() {
    if (!this.outbox.length) return;
    const queued = this.outbox.splice(0);
    this.emitState();
    for (const q of queued) {
      try {
        const result = await this.rpc(q.kind, q.payload);
        q.resolve(result);
      } catch (e) {
        q.reject(e);
      }
    }
  }

  private send(obj: unknown) {
    try { this.ws?.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

// Singleton used across the app.
export const lanClient = new LanClient();
