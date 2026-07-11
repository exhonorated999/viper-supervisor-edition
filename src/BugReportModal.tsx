import { useState } from "react";
import { submitBugReport, type BugSeverity } from "./data/bugReport";
import { isRegistered } from "./data/registration";

const SEVERITIES: { value: BugSeverity; label: string }[] = [
  { value: "low", label: "🟢 Low" },
  { value: "medium", label: "🟡 Medium" },
  { value: "high", label: "🟠 High" },
  { value: "critical", label: "🔴 Critical" },
];

/**
 * "Report to Intellect" bug-report modal. Posts to the Intellect-LE dashboard
 * with the registered API key (self-healing). If the install isn't registered
 * yet, prompts the user to register first via onNeedRegister.
 */
export default function BugReportModal({
  onClose,
  onNeedRegister,
}: {
  onClose: () => void;
  onNeedRegister: () => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("medium");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const registered = isRegistered();

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await submitBugReport({ title, description, severity, steps });
      setOk(id ? `Submitted — thank you! (ID: ${id})` : "Submitted — thank you!");
      setTimeout(onClose, 1600);
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="panel-title">🐛 Report to Intellect</div>
            <div className="page-sub" style={{ marginTop: 4 }}>Report a bug or issue to the V.I.P.E.R. team.</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!registered ? (
          <div className="modal-body">
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
              You need to register this install before submitting a report.
            </div>
            <div className="modal-foot" style={{ paddingLeft: 0, paddingRight: 0, borderTop: "none" }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={onNeedRegister}>Register now</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-body">
              <div className="field">
                <label>Title</label>
                <input className="input" maxLength={300} value={title} disabled={busy}
                  onChange={(e) => setTitle(e.target.value)} placeholder="Brief summary of the issue" />
              </div>
              <div className="field">
                <label>Severity</label>
                <select className="select" value={severity} disabled={busy}
                  onChange={(e) => setSeverity(e.target.value as BugSeverity)}>
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Description</label>
                <textarea className="input" rows={3} value={description} disabled={busy}
                  onChange={(e) => setDescription(e.target.value)} placeholder="What happened? What did you expect?" />
              </div>
              <div className="field">
                <label>Steps to reproduce <span style={{ color: "var(--text-faint)" }}>(optional)</span></label>
                <textarea className="input" rows={3} value={steps} disabled={busy}
                  onChange={(e) => setSteps(e.target.value)} placeholder="1. …  2. …  3. …" />
              </div>
              {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</div>}
              {ok && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>{ok}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || !!ok}>
                {busy ? "Sending…" : "Submit Report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
