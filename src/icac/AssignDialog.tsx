import { useEffect, useMemo, useState } from "react";
import { getOnlineInvestigators, assignCyberTip, assignManual, type OnlineInvestigator } from "./assign";
import { getManualInvestigators, type ManualInvestigator } from "../data/offsystem";
import type { Assignment, CyberTip } from "./types";

// Assign one CyberTip to an investigator — either a live Project VIPER
// investigator on the LAN (only the cybertip NUMBER leaves this machine) OR a
// manual / off-system investigator (tracked LOCALLY, nothing crosses the wire).
export default function AssignDialog({
  tip, onClose, onDone,
}: { tip: CyberTip; onClose: () => void; onDone: () => void }) {
  const [roster, setRoster] = useState<OnlineInvestigator[] | null>(null);
  const manual = useMemo<ManualInvestigator[]>(() => getManualInvestigators(), []);
  // Composite selection key: "lan:<deviceId>" or "manual:<id>".
  const [selected, setSelected] = useState<string>("");
  const [priority, setPriority] = useState<Assignment["priority"]>("Medium");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOnlineInvestigators().then((r) => {
      if (!alive) return;
      setRoster(r);
      if (r.length) setSelected(`lan:${r[0].deviceId}`);
      else if (manual.length) setSelected(`manual:${manual[0].id}`);
    });
    return () => { alive = false; };
  }, [manual]);

  const isManual = selected.startsWith("manual:");
  const hasAny = (roster?.length ?? 0) > 0 || manual.length > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      if (selected.startsWith("manual:")) {
        const m = manual.find((x) => `manual:${x.id}` === selected);
        if (!m) { setError("Select an investigator."); setBusy(false); return; }
        await assignManual(tip, { name: m.name, priority, note });
      } else {
        const investigator = roster?.find((r) => `lan:${r.deviceId}` === selected);
        if (!investigator) { setError("Select an investigator."); setBusy(false); return; }
        await assignCyberTip(tip, { investigator, priority, note });
      }
      onDone();
      onClose();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg === "LAN_OFFLINE"
        ? "Not connected to the LAN node — check Settings → Secure Link."
        : `Assignment failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Assign CyberTip</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-assign-ct">
            <span className="ic-dim">CyberTip</span>
            <span className="mono">{tip.cybertip_number || "—"}</span>
            <span className="ic-dim">{tip.provider}</span>
          </div>

          <div className={`icac-assign-banner${isManual ? " manual" : ""}`}>
            {isManual ? (
              <>👥 Off-system assignment — tracked <b>locally only</b>. Nothing crosses the network
              and there is no automatic acknowledgement. Hand the CyberTip # to the investigator
              through your normal process.</>
            ) : (
              <>🔒 Only the CyberTip number crosses the network. Identifiers, contraband,
              and parsed content stay on this machine. The investigator downloads the
              report contents in their own ICAC system.</>
            )}
          </div>

          <label className="icac-field">
            <span>Investigator</span>
            {roster === null ? (
              <div className="ic-dim">Loading roster…</div>
            ) : !hasAny ? (
              <div className="icac-assign-err">
                No investigators available. Either an investigator must open Project V.I.P.E.R.
                with Supervisor Link enabled, or add a manual investigator in the Investigators view.
              </div>
            ) : (
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {roster.length > 0 && (
                  <optgroup label="● Online (Project VIPER)">
                    {roster.map((r) => (
                      <option key={r.deviceId} value={`lan:${r.deviceId}`}>
                        {r.name} ({r.badge}){r.unit ? ` · ${r.unit}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {manual.length > 0 && (
                  <optgroup label="Manual / Off-System">
                    {manual.map((m) => (
                      <option key={m.id} value={`manual:${m.id}`}>
                        {m.name}{m.badge ? ` (${m.badge})` : ""}{m.unit ? ` · ${m.unit}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </label>

          <label className="icac-field">
            <span>Priority</span>
            <select value={priority ?? "Medium"} onChange={(e) => setPriority(e.target.value as Assignment["priority"])}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>

          <label className="icac-field">
            <span>Note (optional)</span>
            <textarea
              rows={2}
              value={note}
              placeholder="Handling instructions for the investigator…"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {error && <div className="icac-assign-err">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy || !hasAny || !selected}
          >
            {busy ? "Sending…" : isManual ? "Assign (off-system)" : "Assign & Push"}
          </button>
        </div>
      </div>
    </div>
  );
}
