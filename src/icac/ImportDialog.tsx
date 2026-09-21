import { useCallback, useRef, useState } from "react";
import { ingestFiles, type IngestProgress } from "./import/ingest";
import { addTips, createWarrant, saveWarrantPdf } from "./service";
import { getIcacStorage } from "./storage";
import { dataService } from "../data/service";

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
  // Optional Wilson warrant applied to the whole batch on import.
  const [warrantNo, setWarrantNo] = useState("");
  const [warrantFile, setWarrantFile] = useState<File | null>(null);
  const warrantRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setRows([]);
    try {
      // Acquire folder write permission FIRST, while we still hold the transient
      // user activation from the click/drop. Requesting it later (after the long
      // ingestFiles parse) throws "User activation is required to request
      // permissions" once the ~5s activation window has lapsed.
      const storage = getIcacStorage();
      if (storage.ensureWritable) {
        const ok = await storage.ensureWritable();
        if (!ok) {
          setError("Folder permission was denied — set a storage location in Settings → Optional Modules.");
          return;
        }
      }
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
      // Attach the Wilson warrant (if provided) to every tip in this batch.
      let warrantNote = "";
      if (warrantNo.trim()) {
        const w = await createWarrant(
          { warrant_number: warrantNo.trim(), authoredBy: dataService.getIdentity().name || undefined },
          tips.map((t) => t.id),
        );
        if (warrantFile) await saveWarrantPdf(w.id, warrantFile);
        warrantNote = ` · warrant #${w.warrant_number} attached`;
      }
      setSummary(`${added} added, ${updated} updated · ${tips.length} report(s) parsed${warrantNote}`);
      onDone();
    } catch (e: any) {
      setError(String(e?.message || e) + " — set a storage location in Settings → Optional Modules.");
    } finally {
      setBusy(false);
    }
  }, [onDone, warrantNo, warrantFile]);

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

        <div className="icac-import-warrant">
          <div className="icac-import-warrant-head">
            <span>⚖️ Wilson warrant <span className="ic-dim">(optional — applied to this whole batch)</span></span>
          </div>
          <div className="icac-import-warrant-row">
            <input
              className="icac-import-warrant-no"
              placeholder="Warrant number, e.g. 2026-SW-00481"
              value={warrantNo}
              onChange={(e) => setWarrantNo(e.target.value)}
              disabled={busy}
            />
            <input
              ref={warrantRef}
              type="file"
              accept=".pdf"
              style={{ display: "none" }}
              onChange={(e) => setWarrantFile(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => warrantRef.current?.click()} disabled={busy}>
              {warrantFile ? "Change PDF" : "Signed PDF"}
            </button>
            <span className="ic-dim ic-ellipsis" style={{ maxWidth: 160 }}>{warrantFile ? warrantFile.name : "No PDF"}</span>
          </div>
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
                {typeof r.contraband === "number" && r.contraband > 1 && (
                  <span className="ic-multifile" title={`${r.contraband} files reported`}>MULTI-FILE ×{r.contraband}</span>
                )}
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
