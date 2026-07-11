import { useEffect, useState } from "react";
import { dataService } from "./data/service";
import type { SupervisorIdentity } from "./data/identity";
import type { TrustedDevice } from "./data/service";
import AuditLog from "./AuditLog";
import AlertsLog from "./AlertsLog";
import IcacSettings from "./icac/IcacSettings";
import UpdatePanel from "./UpdatePanel";
import RegistrationModal from "./RegistrationModal";
import { isRegistered, getRegistration } from "./data/registration";

type SettingsTab = "general" | "audit" | "alerts";

// Settings — registered identity + secure-link administration for this
// supervisor machine (protocol v2: device key, node pinning, trust store).
// Also hosts the Audit Log and Alerts Log as sub-tabs.
export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [id, setId] = useState<SupervisorIdentity>(() => dataService.getIdentity());
  const [draft, setDraft] = useState<SupervisorIdentity>(id);
  const [saved, setSaved] = useState(false);

  const [deviceId, setDeviceId] = useState<string>("…");
  const [pin, setPin] = useState<string | null>(dataService.getNodePin());
  const [urlDraft, setUrlDraft] = useState<string>(dataService.getNodeUrl());
  const [trusted, setTrusted] = useState<TrustedDevice[]>([]);
  const [showReg, setShowReg] = useState(false);
  const [, setRegTick] = useState(0);
  const registered = isRegistered();
  const reg = getRegistration();

  const dirty = draft.name !== id.name || draft.badge !== id.badge || draft.unit !== id.unit;

  useEffect(() => {
    dataService.getDeviceId().then(setDeviceId).catch(() => setDeviceId("unavailable"));
    loadTrust();
    const t = setInterval(() => setPin(dataService.getNodePin()), 1500);
    return () => clearInterval(t);
  }, []);

  const loadTrust = () => dataService.getTrustedDevices().then(setTrusted).catch(() => {});

  const saveIdentity = () => {
    const next = dataService.updateIdentity({ ...draft });
    setId(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  };

  const myDeviceId = deviceId;

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Registered user, machine identity, secure LAN link, audit &amp; alerts.</div>
        </div>
      </div>

      <div className="settings-tabs">
        <button className={`settings-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>General</button>
        <button className={`settings-tab${tab === "audit" ? " active" : ""}`} onClick={() => setTab("audit")}>Audit Log</button>
        <button className={`settings-tab${tab === "alerts" ? " active" : ""}`} onClick={() => setTab("alerts")}>Alerts Log</button>
      </div>

      {tab === "audit" && <AuditLog embedded />}
      {tab === "alerts" && <AlertsLog />}

      {tab === "general" && (<>
      {/* Registered identity */}
      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="panel-head">
          <h2 className="panel-title">Registered Supervisor</h2>
          <span className="panel-meta">Visible to investigators on the LAN</span>
        </div>

        <div className="field">
          <label>Full name</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Sgt. Michael Reynolds" />
        </div>
        <div className="sign-grid">
          <div className="field">
            <label>Badge / ID</label>
            <input className="input" value={draft.badge} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} placeholder="#0000" />
          </div>
          <div className="field">
            <label>Unit / Command</label>
            <input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="e.g. Major Crimes Unit" />
          </div>
        </div>
        <div className="modal-foot" style={{ paddingRight: 0 }}>
          {saved && <span style={{ color: "var(--green)", alignSelf: "center", marginRight: "auto" }}>✓ Saved &amp; re-registered on LAN</span>}
          <button className="btn btn-ghost" onClick={() => setDraft(id)} disabled={!dirty}>Reset</button>
          <button className="btn btn-primary" onClick={saveIdentity} disabled={!dirty}>Save Identity</button>
        </div>
      </div>

      {/* Intellect-LE registration */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <div className="panel-head">
          <h2 className="panel-title">Intellect-LE Registration</h2>
          <span className="panel-meta">Enables bug reporting &amp; product updates</span>
        </div>
        {registered ? (
          <dl className="kv">
            <dt>Status</dt>
            <dd style={{ color: "var(--green)" }}>✓ Registered</dd>
            <dt>Agency</dt>
            <dd>{reg.agency || "—"}</dd>
            <dt>Agency email</dt>
            <dd>{reg.email || "—"}</dd>
          </dl>
        ) : (
          <div style={{ color: "var(--amber)", fontSize: 13 }}>
            Not registered yet — register to enable bug reporting.
          </div>
        )}
        <div className="modal-foot" style={{ paddingRight: 0 }}>
          <button className="btn btn-ghost" onClick={() => setShowReg(true)}>
            {registered ? "Update Registration" : "Register"}
          </button>
        </div>
      </div>

      {/* Secure link */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <div className="panel-head">
          <h2 className="panel-title">Secure Link</h2>
          <span className="panel-meta">ECDSA/ECDH P-256 · mutual auth · node-key pinned</span>
        </div>

        <dl className="kv">
          <dt>This device ID</dt>
          <dd className="mono">{myDeviceId}</dd>
          <dt>Device key</dt>
          <dd>ECDSA P-256 — private key never leaves this machine</dd>
        </dl>

        <div className="field" style={{ marginTop: 12 }}>
          <label>LAN node address</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="ws://host:7071" />
            <button className="btn btn-ghost" onClick={() => dataService.setNodeUrl(urlDraft)}>Apply</button>
          </div>
        </div>

        <div className="secure-pin">
          <div>
            <div className="section-label" style={{ margin: 0 }}>Pinned node key</div>
            {pin ? (
              <div className="mono" style={{ color: "var(--green)", marginTop: 4 }}>✓ {pin}</div>
            ) : (
              <div style={{ color: "var(--amber)", marginTop: 4, fontSize: 13 }}>Not pinned yet — pins on first secure connect (TOFU).</div>
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => { dataService.resetNodePin(); setPin(null); }} disabled={!pin}>Reset Pin</button>
        </div>
      </div>

      {/* Trusted devices */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <div className="panel-head">
          <h2 className="panel-title">Trusted Devices</h2>
          <button className="btn btn-ghost" onClick={loadTrust}>Refresh</button>
        </div>
        {trusted.length === 0 ? (
          <div className="inbox-empty" style={{ padding: "28px 12px" }}>No devices enrolled yet, or node unreachable.</div>
        ) : (
          <div className="digest-wrap">
            <table className="digest-table">
              <thead>
                <tr><th>Device</th><th>Role</th><th>Last seen</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {trusted.map((d) => (
                  <tr key={d.deviceId} style={d.revoked ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div style={{ color: "#fff" }}>{d.name} {d.badge}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        {d.deviceId}{d.deviceId === myDeviceId ? " (this machine)" : ""}
                      </div>
                    </td>
                    <td>{d.role}</td>
                    <td>{d.lastSeen ? new Date(d.lastSeen).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td>
                      {d.revoked ? <span className="status-chip s-warn">Revoked</span>
                        : d.online ? <span className="status-chip s-ok">Online</span>
                        : <span className="status-chip s-read">Trusted</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d.revoked ? (
                        <button className="btn btn-ghost" style={{ padding: "5px 10px" }} onClick={() => dataService.unrevokeDevice(d.deviceId).then(() => setTimeout(loadTrust, 300))}>Restore</button>
                      ) : d.deviceId !== myDeviceId ? (
                        <button className="btn btn-ghost" style={{ padding: "5px 10px", color: "var(--red)", borderColor: "var(--red)" }} onClick={() => dataService.revokeDevice(d.deviceId).then(() => setTimeout(loadTrust, 300))}>Revoke</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <IcacSettings />
      <UpdatePanel />

      {showReg && (
        <RegistrationModal
          onClose={() => setShowReg(false)}
          onRegistered={() => { setShowReg(false); setRegTick((t) => t + 1); }}
        />
      )}
      </>)}
    </>
  );
}
