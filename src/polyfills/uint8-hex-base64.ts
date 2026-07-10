// Polyfill for the TC39 "Uint8Array to/from base64 and hex" methods.
// pdf.js v6 uses Uint8Array.prototype.toHex() and Uint8Array.fromBase64(),
// which only shipped in Chromium 140 / Firefox 133. Electron 33 ships
// Chromium 130, so these are absent in the desktop shell and pdf.js crashes
// with "a.toHex is not a function". This shim installs the missing methods on
// the current global scope (main thread OR worker) when they are unavailable.
// It is intentionally side-effecting: importing the module installs the shim.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new SyntaxError("hex string length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new SyntaxError("invalid hex character");
    out[i] = byte;
  }
  return out;
}

function base64ToBytes(b64: string, urlSafe = false): Uint8Array {
  let s = b64;
  if (urlSafe) s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  let out = btoa(bin);
  if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return out;
}

export function installUint8Shim(): void {
  const U8 = (globalThis as any).Uint8Array;
  if (!U8) return;
  const proto = U8.prototype as any;

  if (typeof proto.toHex !== "function") {
    Object.defineProperty(proto, "toHex", {
      value(this: Uint8Array): string {
        return bytesToHex(this);
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto.toBase64 !== "function") {
    Object.defineProperty(proto, "toBase64", {
      value(this: Uint8Array, opts?: { alphabet?: string }): string {
        return bytesToBase64(this, opts?.alphabet === "base64url");
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto.setFromHex !== "function") {
    Object.defineProperty(proto, "setFromHex", {
      value(this: Uint8Array, hex: string) {
        const src = hexToBytes(hex);
        const n = Math.min(src.length, this.length);
        this.set(src.subarray(0, n));
        return { read: n * 2, written: n };
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto.setFromBase64 !== "function") {
    Object.defineProperty(proto, "setFromBase64", {
      value(this: Uint8Array, b64: string, opts?: { alphabet?: string }) {
        const src = base64ToBytes(b64, opts?.alphabet === "base64url");
        const n = Math.min(src.length, this.length);
        this.set(src.subarray(0, n));
        return { read: b64.length, written: n };
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof U8.fromHex !== "function") {
    Object.defineProperty(U8, "fromHex", {
      value(hex: string): Uint8Array {
        return hexToBytes(hex);
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof U8.fromBase64 !== "function") {
    Object.defineProperty(U8, "fromBase64", {
      value(b64: string, opts?: { alphabet?: string }): Uint8Array {
        return base64ToBytes(b64, opts?.alphabet === "base64url");
      },
      writable: true,
      configurable: true,
    });
  }
}

installUint8Shim();
