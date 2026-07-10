import { useEffect, useState } from "react";
import { getIdsConfig, setIdsConfig, type IdsConfig } from "./config";
import { idsBridge } from "./bridge";

// Settings → Optional Modules → ICAC → ICAC Data System (IDS).
// Stores the portal URL + login for autofill in the embedded browser. Per the
// operator's choice these are kept in plain localStorage (not the vault).
export default function IdsSettings() {
  const [cfg, setCfg] = useState<IdsConfig>(getIdsConfig());
  const [showPass, setShowPass] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setSaved(false); }, [cfg]);

  const update = (patch: Partial<IdsConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const save = () => {
    setIdsConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  };

  return (
    <div className="icac-sec-block ids-settings">
      <div className="icac-sec-head">
        <div className="icac-sec-title">ICAC Data System (IDS)</div>
        <span className={`ids-shell-chip ${idsBridge.isElectron ? "on" : "off"}`}>
          {idsBridge.isElectron ? "Desktop shell active" : "Web build — browser opens externally"}
        </span>
      </div>

      <div className="ids-form">
        <label className="ids-field">
          <span className="ids-label">IDS portal URL</span>
          <input
            className="icac-vault-input"
            type="url"
            placeholder="https://…"
            value={cfg.url}
            onChange={(e) => update({ url: e.target.value })}
          />
        </label>

        <div className="ids-field-row">
          <label className="ids-field">
            <span className="ids-label">Username</span>
            <input
              className="icac-vault-input"
              type="text"
              autoComplete="off"
              value={cfg.username}
              onChange={(e) => update({ username: e.target.value })}
            />
          </label>
          <label className="ids-field">
            <span className="ids-label">Password</span>
            <div className="ids-pass-wrap">
              <input
                className="icac-vault-input"
                type={showPass ? "text" : "password"}
                autoComplete="off"
                value={cfg.password}
                onChange={(e) => update({ password: e.target.value })}
              />
              <button type="button" className="ids-eye" onClick={() => setShowPass((s) => !s)}>
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </div>

        <label className="ids-check">
          <input
            type="checkbox"
            checked={cfg.autofill}
            onChange={(e) => update({ autofill: e.target.checked })}
          />
          <span>Autofill login automatically when the IDS page loads</span>
        </label>

        <button type="button" className="ids-advanced-toggle" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? "▾" : "▸"} Advanced — field selectors (only if autofill can't find the form)
        </button>

        {showAdvanced && (
          <div className="ids-advanced">
            <label className="ids-field">
              <span className="ids-label">Username field selector</span>
              <input className="icac-vault-input mono" placeholder="input#user" value={cfg.userSel}
                onChange={(e) => update({ userSel: e.target.value })} />
            </label>
            <label className="ids-field">
              <span className="ids-label">Password field selector</span>
              <input className="icac-vault-input mono" placeholder="input#pass" value={cfg.passSel}
                onChange={(e) => update({ passSel: e.target.value })} />
            </label>
            <label className="ids-field">
              <span className="ids-label">Submit button selector (optional — enables auto-submit)</span>
              <input className="icac-vault-input mono" placeholder="button[type=submit]" value={cfg.submitSel}
                onChange={(e) => update({ submitSel: e.target.value })} />
            </label>
          </div>
        )}

        <div className="ids-save-row">
          <button className="btn btn-primary" onClick={save}>Save IDS settings</button>
          {saved && <span className="icac-export-ok">✓ Saved</span>}
        </div>

        <div className="ids-warn">
          ⚠ Credentials are stored unencrypted in this machine's local storage (your chosen option).
          They never leave this device and are never sent over the LAN.
        </div>
      </div>
    </div>
  );
}
