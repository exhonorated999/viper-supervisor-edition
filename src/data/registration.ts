// ---------------------------------------------------------------------------
// Intellect-LE registration + API key (Supervisor Edition).
//
// The Supervisor app has no license/demo gating — registration exists purely to
// obtain an API key so this install can talk to the Intellect Unified Dashboard
// (currently: bug reports). On first run the user provides name / agency /
// agency email / agency address; we POST /api/register and the backend mints an
// api_key. Registration is idempotent server-side (matched on email), so we can
// silently re-register to self-heal a stale/invalid key.
//
// Mirrors Project V.I.P.E.R.'s modules/licensing.js register flow, but under a
// distinct product_slug and localStorage namespace.
// ---------------------------------------------------------------------------

import { updateBridge } from "../update/bridge";

export const API_BASE = "https://intellect-unified-dashboard-production.up.railway.app";
export const PRODUCT_SLUG = "viper-supervisor-edition";
const PREFIX = "viperSup_";

export interface Registration {
  name: string;
  agency: string;
  email: string;
  address: string;
}

function g(k: string): string | null {
  try { return localStorage.getItem(PREFIX + k); } catch { return null; }
}
function s(k: string, v: string) {
  try { localStorage.setItem(PREFIX + k, v); } catch { /* ignore */ }
}

export function isRegistered(): boolean {
  return !!g("api_key") && !!g("registered_at");
}

export function getRegistration(): Registration {
  return {
    name: g("name") || "",
    agency: g("agency") || "",
    email: g("contact_email") || "",
    address: g("address") || "",
  };
}

export function getApiKey(): string | null {
  return g("api_key");
}

/** Best-effort app version for telemetry payloads (empty in web build). */
export async function appVersion(): Promise<string> {
  try { return (await updateBridge.getVersion()) || "0.0.0"; } catch { return "0.0.0"; }
}

async function postRegister(data: Registration): Promise<string> {
  const body = {
    product_slug: PRODUCT_SLUG,
    name: data.name,
    contact_email: data.email,
    agency: data.agency || "",
    address: data.address || "",
  };
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any));
    const detail = Array.isArray(err.detail)
      ? err.detail.map((e: any) => e.msg).join(", ")
      : err.detail;
    throw new Error(detail || `Registration failed (HTTP ${res.status})`);
  }
  const json = await res.json().catch(() => ({} as any));
  if (!json || !json.api_key) throw new Error("Registration returned no API key.");
  return json.api_key as string;
}

/** Register this install and persist the minted API key + details. */
export async function register(data: Registration): Promise<void> {
  const apiKey = await postRegister(data);
  s("registered_at", new Date().toISOString());
  s("api_key", apiKey);
  s("name", data.name);
  s("contact_email", data.email);
  s("agency", data.agency || "");
  s("address", data.address || "");
}

/**
 * Silently re-register with the stored details to refresh a stale/invalid API
 * key. Updates ONLY the api_key. Throws if there's no registration on file.
 */
export async function refreshApiKey(): Promise<string> {
  const reg = getRegistration();
  if (!reg.name || !reg.email) {
    throw new Error("No registration on file — please register from Settings.");
  }
  const apiKey = await postRegister(reg);
  s("api_key", apiKey);
  return apiKey;
}
