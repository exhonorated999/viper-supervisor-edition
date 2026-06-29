// ---------------------------------------------------------------------------
// Node-side crypto for the LAN handshake.
// AES-256-GCM with a PBKDF2-derived key from a pre-shared key (PSK).
// Ciphertext layout matches the browser Web Crypto API: the 16-byte GCM auth
// tag is APPENDED to the ciphertext (ct || tag), so both ends interop.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

export const PBKDF2_ITERATIONS = 150000;
export const PBKDF2_HASH = "sha256";
export const KEY_BYTES = 32; // AES-256
export const IV_BYTES = 12; // GCM standard
export const TAG_BYTES = 16;

/** Derive a 256-bit key from the PSK + salt (salt is a Buffer). */
export function deriveKey(psk, salt) {
  return crypto.pbkdf2Sync(psk, salt, PBKDF2_ITERATIONS, KEY_BYTES, PBKDF2_HASH);
}

/** Encrypt a JS object -> { iv, data } hex strings (data = ct||tag). */
export function encryptJSON(key, obj) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), data: Buffer.concat([ct, tag]).toString("hex") };
}

/** Decrypt { iv, data } -> JS object. Throws if auth tag fails (wrong key). */
export function decryptJSON(key, iv, data) {
  const ivBuf = Buffer.from(iv, "hex");
  const buf = Buffer.from(data, "hex");
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(0, buf.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}
