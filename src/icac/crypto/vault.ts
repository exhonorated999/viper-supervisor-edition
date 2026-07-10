// ICAC encryption-at-rest vault (Phase 7).
//
// The ICAC intelligence database can be encrypted with a supervisor passphrase.
// A random 16-byte salt + PBKDF2-SHA-256 (210k iterations) derives a 256-bit
// AES-GCM key. The key lives ONLY in memory for the session — the passphrase is
// never stored, and neither is the key. On disk we keep just the KDF salt and a
// small "verifier" ciphertext (so a wrong passphrase is rejected fast without
// touching the database file). Everything here is LOCAL; nothing is LAN-bound.
//
// Self-contained: no imports from src/lan/* (ICAC stays LAN-free).
// ---------------------------------------------------------------------------

import type { IcacIndex, VaultEnvelope } from "../types";

const CONFIG_KEY = "viper.supervisor.icac.vault";
const EVENT = "icac:vault";
const PBKDF2_ITERS = 210_000;
const VERIFIER_PLAINTEXT = "VIPER-ICAC-VAULT-v1";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── hex helpers (inline; keeps the module dependency-free) ────────────────
function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function buf(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

// ── pure crypto primitives (exported for testing) ─────────────────────────

/** PBKDF2-SHA-256 → non-extractable AES-256-GCM key. */
export async function deriveKey(passphrase: string, saltHex: string, iters = PBKDF2_ITERS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", buf(enc.encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buf(fromHex(saltHex)), iterations: iters },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** AES-256-GCM encrypt a UTF-8 string → {iv, ct} (hex; ct includes the 16-byte tag). */
export async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(enc.encode(plaintext)));
  return { iv: toHex(iv), ct: toHex(new Uint8Array(ct)) };
}

/** AES-256-GCM decrypt → UTF-8 string. Throws if the tag/passphrase is wrong. */
export async function aesDecrypt(key: CryptoKey, ivHex: string, ctHex: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromHex(ivHex)) }, key, buf(fromHex(ctHex)));
  return dec.decode(pt);
}

function randSaltHex(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

// ── config (localStorage) — salt + verifier only, never the key ───────────

interface VaultConfig {
  v: 1;
  kdf: { salt: string; iters: number };
  verifier: { iv: string; ct: string };
}

function readConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as VaultConfig) : null;
  } catch { return null; }
}
function writeConfig(cfg: VaultConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch { /* ignore */ }
}

// ── session state ─────────────────────────────────────────────────────────

let sessionKey: CryptoKey | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const cb of subs) cb();
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* ignore */ }
}

export function onVaultChange(cb: () => void): () => void {
  subs.add(cb);
  const handler = () => cb();
  try { window.addEventListener("storage", handler); } catch { /* ignore */ }
  return () => { subs.delete(cb); try { window.removeEventListener("storage", handler); } catch { /* ignore */ } };
}

export type VaultState = "off" | "locked" | "unlocked";

export function vaultEnabled(): boolean {
  return readConfig() != null;
}
export function isUnlocked(): boolean {
  return sessionKey != null;
}
export function vaultState(): VaultState {
  if (!vaultEnabled()) return "off";
  return sessionKey ? "unlocked" : "locked";
}

// ── lifecycle ──────────────────────────────────────────────────────────────

/** Turn encryption ON with a fresh passphrase. Leaves the vault UNLOCKED. */
export async function enableVault(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error("Passphrase required.");
  const salt = randSaltHex();
  const key = await deriveKey(passphrase, salt);
  const verifier = await aesEncrypt(key, VERIFIER_PLAINTEXT);
  writeConfig({ v: 1, kdf: { salt, iters: PBKDF2_ITERS }, verifier });
  sessionKey = key;
  emit();
}

/** Attempt to unlock with a passphrase. Returns true on success. */
export async function unlock(passphrase: string): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg) return false;
  try {
    const key = await deriveKey(passphrase, cfg.kdf.salt, cfg.kdf.iters);
    const check = await aesDecrypt(key, cfg.verifier.iv, cfg.verifier.ct);
    if (check !== VERIFIER_PLAINTEXT) return false;
    sessionKey = key;
    emit();
    return true;
  } catch {
    return false; // GCM auth failure = wrong passphrase
  }
}

/** Drop the in-memory key. The database stays encrypted on disk. */
export function lock(): void {
  sessionKey = null;
  emit();
}

/**
 * Re-key the vault with a new passphrase (verifier only). The caller must
 * re-encrypt + persist the database afterwards (the session key changes here).
 */
export async function changePassphrase(oldPass: string, newPass: string): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg || !newPass) return false;
  const oldKey = await deriveKey(oldPass, cfg.kdf.salt, cfg.kdf.iters);
  try {
    const check = await aesDecrypt(oldKey, cfg.verifier.iv, cfg.verifier.ct);
    if (check !== VERIFIER_PLAINTEXT) return false;
  } catch { return false; }
  const salt = randSaltHex();
  const key = await deriveKey(newPass, salt);
  const verifier = await aesEncrypt(key, VERIFIER_PLAINTEXT);
  writeConfig({ v: 1, kdf: { salt, iters: PBKDF2_ITERS }, verifier });
  sessionKey = key;
  emit();
  return true;
}

/** Turn encryption OFF (after verifying the passphrase). Caller re-saves plaintext. */
export async function disableVault(passphrase: string): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg) return true;
  const key = await deriveKey(passphrase, cfg.kdf.salt, cfg.kdf.iters);
  try {
    const check = await aesDecrypt(key, cfg.verifier.iv, cfg.verifier.ct);
    if (check !== VERIFIER_PLAINTEXT) return false;
  } catch { return false; }
  writeConfig(null);
  sessionKey = null;
  emit();
  return true;
}

// ── document encryption ─────────────────────────────────────────────────────

/** Encrypt an IcacIndex into a storable envelope. Requires an unlocked vault. */
export async function encryptIndex(ix: IcacIndex): Promise<VaultEnvelope> {
  if (!sessionKey) throw new Error("ICAC_LOCKED");
  const { iv, ct } = await aesEncrypt(sessionKey, JSON.stringify(ix));
  return { kind: "viper.icac.vault", v: 1, cipher: "AES-256-GCM", iv, ct, updated_at: new Date().toISOString() };
}

/** Decrypt a stored envelope back into an IcacIndex. Requires an unlocked vault. */
export async function decryptEnvelope(env: VaultEnvelope): Promise<IcacIndex> {
  if (!sessionKey) throw new Error("ICAC_LOCKED");
  const json = await aesDecrypt(sessionKey, env.iv, env.ct);
  return JSON.parse(json) as IcacIndex;
}
