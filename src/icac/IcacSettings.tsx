import { useEffect, useState } from "react";
import {
  isIcacEnabled, setIcacEnabled,
  getIcacLocationLabel, onIcacConfigChange,
} from "./config";
import { getIcacStorage, useFallbackStorage } from "./storage/index";
import IcacSecurity from "./IcacSecurity";

// Settings → Optional Modules → ICAC Processing.
// Toggles the module and lets the supervisor choose where the ICAC database is
// stored (a folder or USB drive via the File System Access API, or the in-browser
// fallback). Nothing here touches the LAN.
export default function IcacSettings() {
  const [enabled, setEnabled] = useState(isIcacEnabled());
  const [location, setLocation] = useState<string | null>(getIcacLocationLabel());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const storage = getIcacStorage();
  const fsMode = storage.kind === "fsaccess";

  useEffect(() => onIcacConfigChange(() => {
    setEnabled(isIcacEnabled());
    setLocation(getIcacLocationLabel());
  }), []);

  const toggle = () => setIcacEnabled(!enabled);

  const choose = async () => {
    setErr(null);
    setBusy(true);
    try {
      const label = await getIcacStorage().chooseLocation();
      setLocation(label);
    } catch (e: any) {
      // User cancelled the picker or denied permission → offer fallback.
      if (e?.name !== "AbortError") setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const useBrowser = async () => {
    setErr(null);
    const label = await useFallbackStorage().chooseLocation();
    setLocation(label);
  };

  return (
    <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
      <div className="panel-head">
        <h2 className="panel-title">Optional Modules</h2>
        <span className="panel-meta">Local-only add-ons for this machine</span>
      </div>

      <div className="icac-toggle-row">
        <div>
          <div className="icac-mod-name">ICAC Processing</div>
          <div className="icac-mod-desc">
            Internet Crimes Against Children — bulk CyberTip import, parsing, repeat-suspect
            linking, and assignment. All data stays on this machine; contraband is never opened.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          className={`switch${enabled ? " on" : ""}`}
          onClick={toggle}
        >
          <span className="switch-knob" />
        </button>
      </div>

      {enabled && (
        <div className="icac-storage">
          <div className="section-label" style={{ marginTop: 4 }}>Database location</div>
          <div className="icac-loc-row">
            <div className="icac-loc-label">
              {location ? (
                <span className="mono" style={{ color: "var(--green)" }}>✓ {location}</span>
              ) : (
                <span style={{ color: "var(--amber)" }}>
                  No location chosen yet — pick a folder or USB drive.
                </span>
              )}
            </div>
            {fsMode ? (
              <button className="btn btn-ghost" onClick={choose} disabled={busy}>
                {busy ? "Opening…" : location ? "Change location" : "Choose folder / USB"}
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={useBrowser}>Use in-browser database</button>
            )}
          </div>
          {fsMode ? (
            <div className="icac-hint">
              Stored as <span className="mono">icac_index.json</span> in the folder you pick.
              Choose a USB drive to keep the intelligence database portable and off the network.
            </div>
          ) : (
            <div className="icac-hint">
              This browser doesn't support choosing a folder. Data is kept in a local in-browser
              database on this machine; use Export from the ICAC screen to back it up.
            </div>
          )}
          {err && <div className="icac-hint" style={{ color: "var(--red)" }}>{err}</div>}

          <IcacSecurity hasLocation={location != null} />
        </div>
      )}
    </div>
  );
}
