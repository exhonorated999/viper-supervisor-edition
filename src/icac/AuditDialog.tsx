import { useEffect, useState } from "react";
import { loadAudit, getAuditEntries, onAuditChange, clearAudit, AUDIT_LABELS, type AuditEntry } from "./audit";
import { canMutate } from "./config";

const ACTION_CLASS: Record<string, string> = {
  "vault.unlock.fail": "s-read",
  "vault.disable": "s-warn",
  export: "s-warn",
  assign: "s-ok",
  "assign.ack": "s-ok",
  import: "s-ok",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// Read-only viewer of the local ICAC audit trail. The log lives in this
// machine's IndexedDB and is never transmitted over the LAN.
export default function AuditDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAudit().then(() => { if (alive) setEntries([...getAuditEntries()].reverse()); });
    const off = onAuditChange(() => setEntries([...getAuditEntries()].reverse()));
    return () => { alive = false; off(); };
  }, []);

  const doClear = async () => {
    await clearAudit("manual clear from audit viewer");
    setConfirming(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-audit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">ICAC Audit Log</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-export-notice" style={{ marginBottom: 12 }}>
            🔒 Local record only — {entries.length} entr{entries.length === 1 ? "y" : "ies"}. Never
            transmitted over the LAN. Retained on this machine (most recent 2,000 actions).
          </div>

          {entries.length ? (
            <div className="icac-table-wrap icac-audit-wrap">
              <table className="icac-table">
                <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="ic-dim" style={{ whiteSpace: "nowrap" }}>{fmt(e.at)}</td>
                      <td><span className={`status-chip ${ACTION_CLASS[e.action] || "s-read"}`}>{AUDIT_LABELS[e.action] || e.action}</span></td>
                      <td className="ic-dim ic-ellipsis" title={`${e.actor.name} (${e.actor.badge}) · ${e.actor.role}`}>
                        {e.actor.name} <span className="mono">{e.actor.badge}</span>
                      </td>
                      <td className="ic-dim">{e.detail || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="icac-panel-empty">No audit entries yet.</div>
          )}
        </div>

        <div className="modal-foot">
          {canMutate() && entries.length > 0 && (
            confirming ? (
              <>
                <span className="ic-dim" style={{ marginRight: "auto", fontSize: 12 }}>Clear the entire audit log?</span>
                <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
                <button className="btn btn-danger" onClick={doClear}>Confirm clear</button>
              </>
            ) : (
              <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => setConfirming(true)}>Clear log…</button>
            )
          )}
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
