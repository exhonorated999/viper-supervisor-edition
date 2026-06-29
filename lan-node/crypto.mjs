// ---------------------------------------------------------------------------
// V.I.P.E.R. LAN crypto — protocol v2 (mutual-auth, forward-secret).
//
// Node (ESM) implementation. MUST stay byte-compatible with:
//   src/lan/crypto.ts                              (browser Web Crypto)
//   VIPER/modules/supervisor-link/supervisor-link-crypto.js  (CJS, Electron)
//
// Primitives (all P-256 so browser Web Crypto can interop — Ed25519 is not
// universally available in browsers):
//   • Device / node identity : ECDSA P-256, signatures raw r||s (IEEE-P1363),
//     digest SHA-256.
//   • Ephemeral key agreement: ECDH P-256 → 32-byte shared X coordinate.
//   • Session key            : HKDF-SHA-256(shared, salt=challenge, info) → 32B.
//   • Channel cipher         : AES-256-GCM, 12-byte IV, 16-byte tag APPENDED
//     (ct || tag) to match the Web Crypto layout.
//   • Key fingerprint        : RFC 7638 JWK thumbprint (SHA-256), hex.
//
// The shared-PSK-as-key model (v1) is retired. Trust is per-device: the node
// records each device's public key (TOFU) and can revoke it; clients pin the
// node's static public key.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

export const AEAD_IV_BYTES = 12;
export const AEAD_TAG_BYTES = 16;
export const HKDF_INFO = Buffer.from("VIPER-LAN-session-v2", "utf8");
export const PROTOCOL_VERSION = 2;

// ── random ──────────────────────────────────────────────────────────────
export function randomHex(bytes) { return crypto.randomBytes(bytes).toString("hex"); }

// ── JWK helpers ─────────────────────────────────────────────────────────
// Keep only the public EC fields (drop private 'd' + metadata) for import as
// a public key and for canonical fingerprinting.
function pubOnly(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

// RFC 7638 thumbprint: SHA-256 over the canonical JSON with lexically ordered
// required members {crv, kty, x, y}. Identical string ⇒ identical hash on
// every implementation.
export function jwkThumbprint(jwk) {
  const canon = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

export function deviceIdFromJwk(jwk, prefix = "DEV") {
  return `${prefix}-${jwkThumbprint(jwk).slice(0, 16).toUpperCase()}`;
}

// ── key generation ──────────────────────────────────────────────────────
// Node EC keys are algorithm-agnostic; one generator serves both ECDSA
// (identity) and ECDH (ephemeral) use. JWKs interop with the browser, which
// generates algorithm-specific keys of the same {crv,x,y} shape.
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    publicJwk: publicKey.export({ format: "jwk" }),
    privateJwk: privateKey.export({ format: "jwk" }),
  };
}

// ── signatures (ECDSA P-256, raw r||s) ────────────────────────────────────
export function signUtf8(privateJwk, msg) {
  const key = crypto.createPrivateKey({ key: privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(msg, "utf8"), { key, dsaEncoding: "ieee-p1363" });
  return sig.toString("hex");
}

export function verifyUtf8(publicJwk, msg, sigHex) {
  try {
    const key = crypto.createPublicKey({ key: pubOnly(publicJwk), format: "jwk" });
    return crypto.verify(
      "sha256", Buffer.from(msg, "utf8"),
      { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sigHex, "hex")
    );
  } catch {
    return false;
  }
}

// ── key agreement → session key ───────────────────────────────────────────
// ECDH(myEphemeralPriv, peerEphemeralPub) → HKDF(salt=challenge) → 32-byte key.
export function deriveSessionKey(myPrivJwk, peerPubJwk, saltHex) {
  const priv = crypto.createPrivateKey({ key: myPrivJwk, format: "jwk" });
  const pub = crypto.createPublicKey({ key: pubOnly(peerPubJwk), format: "jwk" });
  const shared = crypto.diffieHellman({ privateKey: priv, publicKey: pub }); // 32-byte X
  const salt = Buffer.from(saltHex, "hex");
  return Buffer.from(crypto.hkdfSync("sha256", shared, salt, HKDF_INFO, 32));
}

// ── AEAD (AES-256-GCM, key = 32-byte session key) ─────────────────────────
export function encryptJSON(key, obj) {
  const iv = crypto.randomBytes(AEAD_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), data: Buffer.concat([ct, tag]).toString("hex") };
}

export function decryptJSON(key, iv, data) {
  const ivBuf = Buffer.from(iv, "hex");
  const buf = Buffer.from(data, "hex");
  const tag = buf.subarray(buf.length - AEAD_TAG_BYTES);
  const ct = buf.subarray(0, buf.length - AEAD_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}

// ── handshake transcript strings (signed; identical on all ends) ──────────
export function nodeProofString(challengeHex, nodeEphThumb) {
  return `viper-node-proof|v2|${challengeHex}|${nodeEphThumb}`;
}
export function deviceProofString(challengeHex, nodeEphThumb, clientEphThumb, deviceId, role) {
  return `viper-device-proof|v2|${challengeHex}|${nodeEphThumb}|${clientEphThumb}|${deviceId}|${role}`;
}
