// ---------------------------------------------------------------------------
// Browser-side crypto for the LAN handshake — protocol v2 (Web Crypto).
//
// MUST interop byte-for-byte with:
//   lan-node/crypto.mjs                              (Node ESM, LAN node)
//   VIPER/modules/supervisor-link/supervisor-link-crypto.js (CJS, Electron)
//
// ECDSA P-256 (identity, raw r||s sigs), ECDH P-256 (ephemeral) → HKDF-SHA-256
// → AES-256-GCM (12-byte IV, 16-byte tag appended). RFC 7638 JWK thumbprints.
// P-256 is chosen because every browser's Web Crypto supports it (unlike
// Ed25519). The shared-PSK-as-key model (v1) is retired.
// ---------------------------------------------------------------------------

export const IV_BYTES = 12;
export const HKDF_INFO_STR = "VIPER-LAN-session-v2";

export interface Jwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
  [k: string]: unknown;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Web Crypto in TS 5.7+ types byte args as BufferSource over ArrayBuffer; our
// Uint8Arrays are ArrayBuffer-backed, so a narrow cast keeps the compiler happy.
function buf(u: Uint8Array | ArrayBuffer): BufferSource {
  return u as unknown as BufferSource;
}

function pubOnly(jwk: Jwk): Jwk {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

// ── RFC 7638 thumbprint ───────────────────────────────────────────────────
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  const canon = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  const digest = await crypto.subtle.digest("SHA-256", buf(enc.encode(canon)));
  return toHex(new Uint8Array(digest));
}

export async function deviceIdFromJwk(jwk: Jwk, prefix = "DEV"): Promise<string> {
  return `${prefix}-${(await jwkThumbprint(jwk)).slice(0, 16).toUpperCase()}`;
}

// ── key generation ──────────────────────────────────────────────────────
export async function generateIdentityKeyPair(): Promise<{ publicJwk: Jwk; privateJwk: Jwk }> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  return {
    publicJwk: (await crypto.subtle.exportKey("jwk", kp.publicKey)) as unknown as Jwk,
    privateJwk: (await crypto.subtle.exportKey("jwk", kp.privateKey)) as unknown as Jwk,
  };
}

export async function generateEphemeralKeyPair(): Promise<{ publicJwk: Jwk; privateJwk: Jwk }> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  return {
    publicJwk: (await crypto.subtle.exportKey("jwk", kp.publicKey)) as unknown as Jwk,
    privateJwk: (await crypto.subtle.exportKey("jwk", kp.privateKey)) as unknown as Jwk,
  };
}

// ── signatures (ECDSA P-256, raw r||s) ────────────────────────────────────
export async function signUtf8(privateJwk: Jwk, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk", privateJwk as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, buf(enc.encode(msg))
  );
  return toHex(new Uint8Array(sig));
}

export async function verifyUtf8(publicJwk: Jwk, msg: string, sigHex: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk", pubOnly(publicJwk) as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, buf(fromHex(sigHex)), buf(enc.encode(msg))
    );
  } catch {
    return false;
  }
}

// ── key agreement → AES-256-GCM session key ───────────────────────────────
export async function deriveSessionKey(
  myPrivJwk: Jwk, peerPubJwk: Jwk, saltHex: string
): Promise<CryptoKey> {
  const myPriv = await crypto.subtle.importKey(
    "jwk", myPrivJwk as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
  const peerPub = await crypto.subtle.importKey(
    "jwk", pubOnly(peerPubJwk) as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peerPub }, myPriv, 256);
  const hk = await crypto.subtle.importKey("raw", buf(shared), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: buf(fromHex(saltHex)), info: buf(enc.encode(HKDF_INFO_STR)) },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── AEAD (AES-256-GCM, ct||tag) ───────────────────────────────────────────
export async function encryptJSON(key: CryptoKey, obj: unknown): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(iv) }, key, buf(enc.encode(JSON.stringify(obj)))
  );
  return { iv: toHex(iv), data: toHex(new Uint8Array(ct)) };
}

export async function decryptJSON<T = unknown>(key: CryptoKey, iv: string, data: string): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(fromHex(iv)) }, key, buf(fromHex(data))
  );
  return JSON.parse(dec.decode(pt)) as T;
}

// ── handshake transcript strings (identical on all ends) ──────────────────
export function nodeProofString(challengeHex: string, nodeEphThumb: string): string {
  return `viper-node-proof|v2|${challengeHex}|${nodeEphThumb}`;
}
export function deviceProofString(
  challengeHex: string, nodeEphThumb: string, clientEphThumb: string, deviceId: string, role: string
): string {
  return `viper-device-proof|v2|${challengeHex}|${nodeEphThumb}|${clientEphThumb}|${deviceId}|${role}`;
}
