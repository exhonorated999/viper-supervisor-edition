// ---------------------------------------------------------------------------
// Per-machine device identity key (Supervisor Edition).
//
// Protocol v2: a machine is identified by an ECDSA P-256 keypair generated
// once and persisted. The deviceId is the key's RFC 7638 thumbprint, so the
// LAN node can verify that whoever presents this deviceId also holds the
// matching private key (challenge-response). Revocation is per-key.
//
// Stored in localStorage (prototype). The private JWK never leaves this app.
// ---------------------------------------------------------------------------

import { generateIdentityKeyPair, deviceIdFromJwk, type Jwk } from "./crypto";

const KEY = "viper.supervisor.devicekey";

export interface DeviceKey {
  publicJwk: Jwk;
  privateJwk: Jwk;
  deviceId: string;
}

let cached: DeviceKey | null = null;

/** Load the persisted device key, or generate + persist a fresh one. */
export async function getDeviceKey(): Promise<DeviceKey> {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { publicJwk: Jwk; privateJwk: Jwk };
      if (parsed.publicJwk && parsed.privateJwk) {
        cached = {
          publicJwk: parsed.publicJwk,
          privateJwk: parsed.privateJwk,
          deviceId: await deviceIdFromJwk(parsed.publicJwk, "DEV"),
        };
        return cached;
      }
    }
  } catch {
    /* fall through to fresh keypair */
  }
  const kp = await generateIdentityKeyPair();
  const deviceId = await deviceIdFromJwk(kp.publicJwk, "DEV");
  cached = { ...kp, deviceId };
  try {
    localStorage.setItem(KEY, JSON.stringify({ publicJwk: kp.publicJwk, privateJwk: kp.privateJwk }));
  } catch {
    /* ignore quota */
  }
  return cached;
}

/** deviceId if already loaded, else null (for synchronous UI first paint). */
export function getDeviceIdSync(): string | null {
  return cached?.deviceId ?? null;
}
