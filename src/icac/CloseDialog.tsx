// Bulk close-out dialog. A supervisor selects one reason (and an optional note)
// to close N CyberTips that won't be investigated. Closed tips are retained in
// the store + exports but hidden from active views. Nothing crosses the LAN.
import { useEffect, useState } from "react";
import type { CloseReason } from "./types";
import { closeTips } from "./service";

const REASONS: CloseReason[] = [
  "Not CSAM",
  "Not a crime",
  "Unfounded",
  "Duplicate",
  "Insufficient info",
  "Other",
];

export default function CloseDialog({
  ids,
  by,
  onClose,
  onDone,
}: {
  ids: string[];
  by: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<CloseReason>("Not CSAM");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const needsNote = reason === "Other";
  const invalid = needsNote && !note.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (invalid || busy) return;
    setBusy(true);
    try {
      await closeTips(ids, { reason, note: note.trim() || undefined, by });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-close-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Close {ids.length} CyberTip{ids.length === 1 ? "" : "s"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-close-lead">
            Closed tips stay in the database and exports for the record, but are
            hidden from active queues. You can reopen them later via “Show closed”.
          </div>

          <div className="icac-field">
            <span>Reason</span>
            <div className="icac-close-reasons">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`icac-close-reason${reason === r ? " sel" : ""}`}
                  onClick={() => setReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="icac-field">
            <span>{needsNote ? "Note (required)" : "Note (optional)"}</span>
            <textarea
              className="icac-close-note"
              rows={3}
              value={note}
              placeholder={needsNote ? "Describe the reason for closing…" : "Add context (optional)…"}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={confirm} disabled={invalid || busy}>
            {busy ? "Closing…" : `Close ${ids.length} tip${ids.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
