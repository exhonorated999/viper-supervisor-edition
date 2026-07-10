// Phase 7 vault crypto smoke-test. Exercises the pure primitives that back the
// encryption-at-rest vault (the stateful layer needs localStorage, so it is
// verified via tsc + the app). Node 18+ exposes Web Crypto globally.
// Run: npx tsx scripts\icac-vault-check.mts
// ---------------------------------------------------------------------------

import { deriveKey, aesEncrypt, aesDecrypt } from "../src/icac/crypto/vault";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  " + extra : ""}`); }
}

const SALT = "0123456789abcdef0123456789abcdef"; // 16 bytes hex
const VERIFIER = "VIPER-ICAC-VAULT-v1";

async function main() {
  const key = await deriveKey("correct horse battery staple", SALT, 50_000);

  // round-trip
  const doc = JSON.stringify({ version: 1, tips: [{ cybertip_number: "111" }] });
  const { iv, ct } = await aesEncrypt(key, doc);
  ok("iv is 12 bytes (24 hex)", iv.length === 24, iv.length + " hex chars");
  ok("ct includes 16-byte tag", ct.length / 2 >= doc.length + 16);
  const back = await aesDecrypt(key, iv, ct);
  ok("decrypt round-trips", back === doc);

  // verifier pattern
  const v = await aesEncrypt(key, VERIFIER);
  ok("verifier decrypts under same key", (await aesDecrypt(key, v.iv, v.ct)) === VERIFIER);

  // wrong passphrase → different key → GCM auth failure
  const wrong = await deriveKey("wrong passphrase", SALT, 50_000);
  let threw = false;
  try { await aesDecrypt(wrong, v.iv, v.ct); } catch { threw = true; }
  ok("wrong passphrase rejected (GCM auth)", threw);

  // salt matters: same passphrase, different salt → different key
  const otherSalt = "ffffffffffffffffffffffffffffffff";
  const k2 = await deriveKey("correct horse battery staple", otherSalt, 50_000);
  let threw2 = false;
  try { await aesDecrypt(k2, v.iv, v.ct); } catch { threw2 = true; }
  ok("different salt → cannot decrypt", threw2);

  // tampered ciphertext → auth failure
  const tampered = ct.slice(0, -2) + (ct.slice(-2) === "00" ? "01" : "00");
  let threw3 = false;
  try { await aesDecrypt(key, iv, tampered); } catch { threw3 = true; }
  ok("tampered ciphertext rejected", threw3);

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
