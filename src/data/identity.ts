// ---------------------------------------------------------------------------
// Registered supervisor identity (name / badge / unit) for this machine.
//
// The machine *address* (deviceId) is no longer a random string — under
// protocol v2 it is the fingerprint of this machine's device key (see
// src/lan/devicekey.ts). This module only owns the human-facing identity that
// investigators see in their push picker.
// ---------------------------------------------------------------------------

export interface SupervisorIdentity {
  name: string;
  badge: string;
  unit: string;
}

const KEY = "viper.supervisor.identity";

const DEFAULTS: SupervisorIdentity = {
  name: "",
  badge: "",
  unit: "",
};

export function loadIdentity(): SupervisorIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SupervisorIdentity>;
      return {
        name: parsed.name ?? DEFAULTS.name,
        badge: parsed.badge ?? DEFAULTS.badge,
        unit: parsed.unit ?? DEFAULTS.unit,
      };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULTS };
}

export function saveIdentity(id: SupervisorIdentity): void {
  try { localStorage.setItem(KEY, JSON.stringify(id)); } catch { /* ignore */ }
}
