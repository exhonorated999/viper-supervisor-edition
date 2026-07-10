import { useCallback, useRef, useState } from "react";
import { ingestFiles, type IngestProgress } from "./import/ingest";
import { addTips } from "./service";

// Minimal ICAC import dialog: drag-and-drop or pick ZIPs / PDFs, run the
// validated parser pipeline, and persist to the chosen storage location. The
// full import-queue screen (status lanes, retries) is a later polish item.
export default function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<IngestProgress[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setRows([]);
    try {
      const { tips } = await ingestFiles(files, (p) => {
        setRows((prev) => {
          const i = prev.findIndex((r) => r.fileName === p.fileName);
          if (i >= 0) { const next = prev.slice(); next[i] = p; return next; }
          return [...prev, p];
        });
      });
      if (!tips.length) {
        setError("No CyberTips could be parsed from the selected files.");
        return;
      }
      const { added, updated } = await addTips(tips);
      setSummary(`${added} added, ${updated} updated · ${tips.length} report(s) parsed`);
      onDone();
    } catch (e: any) {
      setError(String(e?.message || e) + " — set a storage location in Settings → Optional Modules.");
    } finally {
      setBusy(false);
    }
  }, [onDone]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    run(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Import CyberTips</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
        <div
          className={`icac-dropzone${drag ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".zip,.pdf"
            style={{ display: "none" }}
            onChange={(e) => run(Array.from(e.target.files ?? []))}
          />
          <div className="icac-dz-title">Drop CyberTip ZIPs or PDFs here</div>
          <div className="icac-dz-sub">or click to browse · contraband media is never opened</div>
        </div>

        {rows.length > 0 && (
          <div className="icac-import-list">
            {rows.map((r, i) => (
              <div className="icac-import-row" key={r.fileName + i}>
                <span className={`ic-status ic-${r.status}`} />
                <span className="ic-name" title={r.fileName}>{r.fileName}</span>
                <span className="ic-detail">
                  {r.provider ? `${r.provider} · ` : ""}
                  {typeof r.contraband === "number" ? `${r.contraband} media · ` : ""}
                  {r.detail || r.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {summary && <div className="icac-import-ok">✓ {summary}</div>}
        {error && <div className="icac-import-err">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Parsing…" : "Choose files"}
          </button>
        </div>
      </div>
    </div>
  );
}
