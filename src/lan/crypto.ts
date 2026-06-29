// ---------------------------------------------------------------------------
// Browser-side crypto for the LAN handshake (Web Crypto / SubtleCrypto).
// Must interop byte-for-byte with lan-node/crypto.mjs:
//   - PBKDF2(SHA-256, 150000 iters) -> AES-256 key
//   - AES-256-GCM, 12-byte IV, 16-byte tag appended to ciphertext (ct||tag)
// ---------------------------------------------------------------------------

export const PBKDF2_HASH = "SHA-256";
export const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// Web Crypto in TS 5.7+ types byte args as BufferSource over ArrayBuffer; our
// Uint8Arrays are ArrayBuffer-backed, so a narrow cast keeps the compiler happy.
function buf(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

/** Derive an AES-256-GCM key from the PSK + salt (matches the Node side). */
export async function deriveKey(
  psk: string,
  saltHex: string,
  iterations: number
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    buf(enc.encode(psk)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: buf(fromHex(saltHex)),
      iterations,
      hash: PBKDF2_HASH,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJSON(
  key: CryptoKey,
  obj: unknown
): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(iv) },
    key,
    buf(enc.encode(JSON.stringify(obj)))
  );
  return { iv: toHex(iv), data: toHex(new Uint8Array(ct)) };
}

export async function decryptJSON<T = unknown>(
  key: CryptoKey,
  iv: string,
  data: string
): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(fromHex(iv)) },
    key,
    buf(fromHex(data))
  );
  return JSON.parse(dec.decode(pt)) as T;
}
