import { useEffect, useState } from "react";
import { getOnlineInvestigators, assignCyberTip, type OnlineInvestigator } from "./assign";
import type { Assignment, CyberTip } from "./types";

// Assign one CyberTip to an online investigator. Only the cybertip NUMBER
// (plus priority/note) leaves this machine — the banner makes that explicit.
export default function AssignDialog({
  tip, onClose, onDone,
}: { tip: CyberTip; onClose: () => void; onDone: () => void }) {
  const [roster, setRoster] = useState<OnlineInvestigator[] | null>(null);
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
      if (r.length) setSelected(r[0].deviceId);
    });
    return () => { alive = false; };
  }, []);

  const send = async () => {
    const investigator = roster?.find((r) => r.deviceId === selected);
    if (!investigator) { setError("Select an investigator."); return; }
    setBusy(true);
    setError(null);
    try {
      await assignCyberTip(tip, { investigator, priority, note });
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

          <div className="icac-assign-banner">
            🔒 Only the CyberTip number crosses the network. Identifiers, contraband,
            and parsed content stay on this machine. The investigator downloads the
            report contents in their own ICAC system.
          </div>

          <label className="icac-field">
            <span>Investigator</span>
            {roster === null ? (
              <div className="ic-dim">Loading roster…</div>
            ) : roster.length === 0 ? (
              <div className="icac-assign-err">No investigators are online. They must open Project V.I.P.E.R. with Supervisor Link enabled.</div>
            ) : (
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {roster.map((r) => (
                  <option key={r.deviceId} value={r.deviceId}>
                    {r.name} ({r.badge}){r.unit ? ` · ${r.unit}` : ""}
                  </option>
                ))}
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
            disabled={busy || !roster || roster.length === 0}
          >
            {busy ? "Sending…" : "Assign & Push"}
          </button>
        </div>
      </div>
    </div>
  );
}
