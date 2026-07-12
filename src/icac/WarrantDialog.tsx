import { useMemo, useRef, useState } from "react";
import { getWarrants, createWarrant, attachWarrant, saveWarrantPdf } from "./service";

// Attach a Wilson warrant to the selected CyberTips — either an existing
// warrant (bulk warrants often cover many downloads) or a newly-authored one
// with an optional signed-PDF upload. 100% LOCAL; nothing crosses the LAN.
export default function WarrantDialog({
  tipIds, by, onClose, onDone,
}: { tipIds: string[]; by: string; onClose: () => void; onDone: () => void }) {
  const warrants = useMemo(() => getWarrants(), []);
  const [mode, setMode] = useState<"existing" | "new">(warrants.length ? "existing" : "new");
  const [selected, setSelected] = useState<string>(warrants[0]?.id ?? "");

  const [number, setNumber] = useState("");
  const [court, setCourt] = useState("");
  const [judge, setJudge] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "existing") {
        if (!selected) { setError("Select a warrant."); setBusy(false); return; }
        await attachWarrant(tipIds, selected);
      } else {
        if (!number.trim()) { setError("Warrant number is required."); setBusy(false); return; }
        const w = await createWarrant(
          {
            warrant_number: number.trim(),
            court: court.trim() || undefined,
            judge: judge.trim() || undefined,
            signed_at: signedAt || undefined,
            note: note.trim() || undefined,
            authoredBy: by,
          },
          tipIds,
        );
        if (file) await saveWarrantPdf(w.id, file);
      }
      onDone();
      onClose();
    } catch (e: any) {
      setError(`Failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-warrant-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Attach Wilson Warrant</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-warrant-lead">
            Link a judge-authorized warrant to <b>{tipIds.length}</b> selected CyberTip
            {tipIds.length === 1 ? "" : "s"}. This keeps the warrant retrievable at court time.
          </div>

          {warrants.length > 0 && (
            <div className="icac-warrant-modeswitch">
              <button
                type="button"
                className={`icac-seg${mode === "existing" ? " sel" : ""}`}
                onClick={() => setMode("existing")}
              >Use existing</button>
              <button
                type="button"
                className={`icac-seg${mode === "new" ? " sel" : ""}`}
                onClick={() => setMode("new")}
              >New warrant</button>
            </div>
          )}

          {mode === "existing" ? (
            <label className="icac-field">
              <span>Warrant</span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {warrants.map((w) => (
                  <option key={w.id} value={w.id}>
                    #{w.warrant_number}{w.court ? ` · ${w.court}` : ""} · {w.covered_tip_ids.length} tip(s)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="icac-field">
                <span>Warrant number *</span>
                <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 2026-SW-00481" />
              </label>
              <div className="icac-warrant-2col">
                <label className="icac-field">
                  <span>Court</span>
                  <input value={court} onChange={(e) => setCourt(e.target.value)} placeholder="e.g. 5th Judicial District" />
                </label>
                <label className="icac-field">
                  <span>Judge</span>
                  <input value={judge} onChange={(e) => setJudge(e.target.value)} placeholder="Signing judge" />
                </label>
              </div>
              <label className="icac-field">
                <span>Signed date</span>
                <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
              </label>
              <label className="icac-field">
                <span>Signed PDF (optional)</span>
                <div className="icac-warrant-file">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    style={{ display: "none" }}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                    {file ? "Change PDF" : "Choose PDF"}
                  </button>
                  <span className="ic-dim ic-ellipsis">{file ? file.name : "No file selected"}</span>
                </div>
              </label>
              <label className="icac-field">
                <span>Note (optional)</span>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bulk warrant covering 05/12 download batch" />
              </label>
            </>
          )}

          {error && <div className="icac-assign-err">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || tipIds.length === 0}>
            {busy ? "Saving…" : mode === "existing" ? "Attach" : "Create & Attach"}
          </button>
        </div>
      </div>
    </div>
  );
}
