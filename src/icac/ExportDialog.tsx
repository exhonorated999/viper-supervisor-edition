import { useMemo, useState } from "react";
import type { CyberTip } from "./types";
import { filterTips } from "./export/rows";
import { runExport, type ExportFormat, type ExportScope } from "./export";

const FORMATS: { id: ExportFormat; label: string; sub: string }[] = [
  { id: "csv", label: "CSV", sub: "Flat table · Excel / any tool" },
  { id: "xlsx", label: "Spreadsheet", sub: "Multi-sheet .xlsx workbook" },
  { id: "json", label: "JSON", sub: "Full records · re-importable" },
  { id: "pdf", label: "PDF Summary", sub: "One-page command briefing" },
];

const SCOPES: { id: ExportScope; label: string }[] = [
  { id: "all", label: "All tips" },
  { id: "unassigned", label: "Unassigned only" },
  { id: "contraband", label: "With contraband only" },
];

// Export the ICAC intelligence store to a local file. This is a LOCAL download
// — nothing here crosses the LAN. CSV/XLSX/JSON carry investigative detail; the
// PDF is a metadata-only briefing.
export default function ExportDialog({
  tips, unit, onClose,
}: { tips: CyberTip[]; unit: string; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<ExportScope>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const count = useMemo(() => filterTips(tips, scope).length, [tips, scope]);

  const doExport = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await runExport({ format, scope, unit, tips });
      setDone(`${res.filename} · ${res.count} tip${res.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      setError(`Export failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Export Center</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-field">
            <span>Format</span>
            <div className="icac-fmt-grid">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`icac-fmt-card${format === f.id ? " sel" : ""}`}
                  onClick={() => setFormat(f.id)}
                >
                  <span className="icac-fmt-label">{f.label}</span>
                  <span className="icac-fmt-sub">{f.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="icac-field">
            <span>Scope</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
              {SCOPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>

          <div className="icac-export-count">
            {count} tip{count === 1 ? "" : "s"} will be exported.
          </div>

          <div className="icac-export-notice">
            🔒 Local download only — never transmitted over the LAN.
            {format === "pdf"
              ? " The PDF is a metadata-only command briefing (no identifiers dumped)."
              : " Contains investigative identifiers; no contraband media is included (metadata only)."}
            {" "}Handle per agency evidence policy.
          </div>

          {error && <div className="icac-assign-err">{error}</div>}
          {done && <div className="icac-export-ok">Saved {done}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn btn-primary" onClick={doExport} disabled={busy || count === 0}>
            {busy ? "Building…" : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
