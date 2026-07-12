import { useMemo, useState } from "react";
import { getWarrants, getTips, loadWarrantPdf, deleteWarrant } from "./service";
import type { Warrant } from "./types";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Read-only registry of Wilson warrants with their covered CyberTips, signed-PDF
// access, and a court-ready coverage report. Solves the "lost warrant" problem
// by making the warrant → tip mapping explicit and exportable. 100% LOCAL.
export default function WarrantsDialog({
  onClose, onChanged,
}: { onClose: () => void; onChanged: () => void }) {
  const [warrants, setWarrants] = useState<Warrant[]>(() => getWarrants());
  const [expanded, setExpanded] = useState<string | null>(null);
  const tips = useMemo(() => getTips(), []);

  const ctNumFor = (id: string): string => {
    const t = tips.find((x) => x.id === id);
    return t?.cybertip_number || "(no #)";
  };

  const viewPdf = async (w: Warrant) => {
    const blob = await loadWarrantPdf(w.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const exportCoverage = (w: Warrant) => {
    const head = ["warrant_number", "court", "judge", "signed_at", "signed_pdf", "cybertip_number", "provider", "date_received"];
    const lines = [head.join(",")];
    if (w.covered_tip_ids.length === 0) {
      lines.push([w.warrant_number, w.court, w.judge, w.signed_at, w.signed_pdf_name, "", "", ""].map(csvCell).join(","));
    }
    for (const id of w.covered_tip_ids) {
      const t = tips.find((x) => x.id === id);
      lines.push([
        w.warrant_number, w.court, w.judge, w.signed_at, w.signed_pdf_name,
        t?.cybertip_number, t?.provider, t?.date_received,
      ].map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warrant-coverage-${(w.warrant_number || "warrant").replace(/[^\w.-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const doDelete = async (w: Warrant) => {
    if (!window.confirm(`Delete warrant #${w.warrant_number}? Covered CyberTips will be unlinked (the tips themselves are kept).`)) return;
    await deleteWarrant(w.id);
    setWarrants(getWarrants());
    onChanged();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-warrants-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="panel-title">Wilson Warrants</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="icac-warrant-lead">
            Registry of judge-authorized warrants and the CyberTips each one covers.
            Export a coverage report to keep the warrant → tip mapping on file for court.
          </div>

          {warrants.length === 0 ? (
            <div className="icac-panel-empty">No warrants yet. Attach one from the Assignment Queue or during import.</div>
          ) : (
            <div className="icac-warrant-list">
              {warrants.map((w) => (
                <div className="icac-warrant-card" key={w.id}>
                  <div className="icac-warrant-top">
                    <div>
                      <span className="icac-warrant-num">#{w.warrant_number}</span>
                      <span className="icac-warrant-cover">{w.covered_tip_ids.length} tip{w.covered_tip_ids.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="icac-warrant-actions">
                      {w.signed_pdf_key && (
                        <button className="btn btn-ghost btn-sm" onClick={() => viewPdf(w)}>View PDF</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => exportCoverage(w)}>Coverage CSV</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
                        {expanded === w.id ? "Hide tips" : "Show tips"}
                      </button>
                      <button className="btn btn-ghost btn-sm icac-warrant-del" onClick={() => doDelete(w)}>Delete</button>
                    </div>
                  </div>
                  <div className="icac-warrant-meta">
                    {[w.court, w.judge && `Judge ${w.judge}`, w.signed_at && `Signed ${w.signed_at}`, w.signed_pdf_name]
                      .filter(Boolean).join(" · ") || "No metadata"}
                  </div>
                  {w.note && <div className="icac-warrant-note">{w.note}</div>}
                  {expanded === w.id && (
                    <div className="icac-warrant-tips">
                      {w.covered_tip_ids.length === 0
                        ? <span className="ic-dim">No tips linked.</span>
                        : w.covered_tip_ids.map((id) => (
                            <span className="mono icac-warrant-ct" key={id}>{ctNumFor(id)}</span>
                          ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
