import { useMemo, useState } from "react";
import {
  addManualCase, updateManualCase, getManualInvestigators, type ManualCase,
} from "./data/offsystem";

// Create or edit a lightweight, supervisor-authored case for an off-system
// investigator. Purely local — never crosses the LAN, no status lifecycle.
export default function ManualCaseDialog({
  existing, onClose, onDone,
}: { existing?: ManualCase; onClose: () => void; onDone: () => void }) {
  const investigators = useMemo(() => getManualInvestigators(), []);
  const [caseNumber, setCaseNumber] = useState(existing?.case_number ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [assigneeId, setAssigneeId] = useState(existing?.assignee_id ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!caseNumber.trim() && !title.trim()) { setError("Enter a case number or title."); return; }
    const inv = investigators.find((x) => x.id === assigneeId);
    const data = {
      case_number: caseNumber.trim(),
      title: title.trim(),
      assignee_id: inv?.id ?? existing?.assignee_id,
      assignee_name: inv?.name ?? existing?.assignee_name,
      note: note.trim() || undefined,
    };
    if (existing) updateManualCase({ ...existing, ...data });
    else addManualCase(data);
    onDone();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">{existing ? "Edit" : "New"} Off-System Case</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="icac-assign-banner">
            👥 A lightweight case record for an off-system investigator. Tracked locally only.
          </div>
          <div className="icac-warrant-2col">
            <label className="icac-field"><span>Case number</span>
              <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="e.g. 26-0142" />
            </label>
            <label className="icac-field"><span>Assign to</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">— Unassigned —</option>
                {investigators.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.badge ? ` (${m.badge})` : ""}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="icac-field"><span>Title / description</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short case title" />
          </label>
          <label className="icac-field"><span>Note (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {investigators.length === 0 && (
            <div className="ic-soon-note">Tip: add off-system investigators in the Investigators view to assign them.</div>
          )}
          {error && <div className="icac-assign-err">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{existing ? "Save" : "Create case"}</button>
        </div>
      </div>
    </div>
  );
}
