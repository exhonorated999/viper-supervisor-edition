import { useState } from "react";
import {
  addManualInvestigator, updateManualInvestigator, type ManualInvestigator,
} from "./data/offsystem";

// Add or edit a manual / off-system investigator (one who does not run Project
// V.I.P.E.R.). Purely local — this roster never crosses the LAN.
export default function ManualInvestigatorDialog({
  existing, onClose, onDone,
}: { existing?: ManualInvestigator; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [badge, setBadge] = useState(existing?.badge ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) { setError("Name is required."); return; }
    const data = {
      name: name.trim(),
      badge: badge.trim() || undefined,
      unit: unit.trim() || undefined,
      email: email.trim() || undefined,
    };
    if (existing) updateManualInvestigator({ ...existing, ...data });
    else addManualInvestigator(data);
    onDone();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">{existing ? "Edit" : "Add"} Off-System Investigator</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="icac-assign-banner">
            👥 Off-system investigators are tracked locally so you can assign CyberTips and
            cases even when your officers don't run Project V.I.P.E.R. This roster never
            crosses the network.
          </div>
          <label className="icac-field"><span>Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </label>
          <div className="icac-warrant-2col">
            <label className="icac-field"><span>Badge</span>
              <input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Badge / ID" />
            </label>
            <label className="icac-field"><span>Unit</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit / division" />
            </label>
          </div>
          <label className="icac-field"><span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </label>
          {error && <div className="icac-assign-err">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{existing ? "Save" : "Add investigator"}</button>
        </div>
      </div>
    </div>
  );
}
