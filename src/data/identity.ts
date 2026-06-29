// ---------------------------------------------------------------------------
// Supervisor machine identity.
//
// RFP / integration requirement: "Each Supervisor machine should be identified
// by the registered user found in the Settings of the Supervisor Edition."
//
// This identity is what an investigator (Project V.I.P.E.R.) sees in the
// "Push to Supervisor" picker, and what the LAN node uses to address
// deliveries. The deviceId is generated once and persisted so the same
// machine keeps a stable address across restarts.
// ---------------------------------------------------------------------------

export interface SupervisorIdentity {
  deviceId: string; // stable machine address (generated once)
  name: string; // registered supervisor name
  badge: string; // badge / ID number
  unit: string; // unit / command
}

const KEY = "viper.supervisor.identity";

const DEFAULTS: Omit<SupervisorIdentity, "deviceId"> = {
  name: "Sgt. Michael Reynolds",
  badge: "#4521",
  unit: "Major Crimes Unit",
};

function genDeviceId(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const tail = Date.now().toString(36).toUpperCase().slice(-4);
  return `SUP-${rand}-${tail}`;
}

export function loadIdentity(): SupervisorIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SupervisorIdentity>;
      const id: SupervisorIdentity = {
        deviceId: parsed.deviceId || genDeviceId(),
        name: parsed.name || DEFAULTS.name,
        badge: parsed.badge || DEFAULTS.badge,
        unit: parsed.unit || DEFAULTS.unit,
      };
      if (!parsed.deviceId) saveIdentity(id); // backfill a stable id
      return id;
    }
  } catch {
    /* fall through to fresh identity */
  }
  const fresh: SupervisorIdentity = { deviceId: genDeviceId(), ...DEFAULTS };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(id: SupervisorIdentity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore quota / availability */
  }
}
