import { useState } from "react";
import { dataService } from "./data/service";
import type { SupervisorIdentity } from "./data/identity";

// Settings — the registered-user identity for THIS supervisor machine.
// Investigators see this name/unit in their "Push to Supervisor" picker, and
// the LAN node addresses deliveries to this machine's deviceId.
export default function Settings() {
  const [id, setId] = useState<SupervisorIdentity>(() => dataService.getIdentity());
  const [draft, setDraft] = useState<SupervisorIdentity>(id);
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.name !== id.name || draft.badge !== id.badge || draft.unit !== id.unit;

  const save = () => {
    const next = dataService.updateIdentity({ ...draft });
    setId(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">
            Registered user &amp; machine identity for LAN delivery.
          </div>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 680 }}>
        <div className="panel-head">
          <h2 className="panel-title">Registered Supervisor</h2>
          <span className="panel-meta">Visible to investigators on the LAN</span>
        </div>

        <div className="field">
          <label>Full name</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Sgt. Michael Reynolds"
          />
        </div>

        <div className="sign-grid">
          <div className="field">
            <label>Badge / ID</label>
            <input
              className="input"
              value={draft.badge}
              onChange={(e) => setDraft({ ...draft, badge: e.target.value })}
              placeholder="#0000"
            />
          </div>
          <div className="field">
            <label>Unit / Command</label>
            <input
              className="input"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              placeholder="e.g. Major Crimes Unit"
            />
          </div>
        </div>

        <div className="section-label" style={{ margin: "14px 0 8px" }}>
          Machine Address
        </div>
        <dl className="kv">
          <dt>Device ID</dt>
          <dd style={{ fontFamily: "var(--mono, monospace)", letterSpacing: 0.4 }}>
            {id.deviceId}
          </dd>
          <dt>Discovery</dt>
          <dd>
            Broadcast on LAN as{" "}
            <strong style={{ color: "var(--text)" }}>
              {id.name} — {id.unit}
            </strong>
          </dd>
        </dl>

        <div className="modal-foot" style={{ paddingRight: 0 }}>
          {saved && (
            <span style={{ color: "var(--green)", alignSelf: "center", marginRight: "auto" }}>
              ✓ Saved &amp; re-registered on LAN
            </span>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => setDraft(id)}
            disabled={!dirty}
          >
            Reset
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>
            Save Identity
          </button>
        </div>
      </div>
    </>
  );
}
