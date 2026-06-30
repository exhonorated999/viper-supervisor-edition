import { useState } from "react";
import type { OpsPlan } from "./types";
import { dataService } from "./data/service";

interface Props {
  plan: OpsPlan;
  supervisorName: string;
  badge: string;
  onClose: () => void;
  onResolved: (plan: OpsPlan) => void;
}

const riskClass = (r: OpsPlan["risk"]) =>
  r === "High Risk" ? "high" : r === "Medium Risk" ? "medium" : "low";

/** Decode the attached base64 PDF and open it in a new tab. */
function openPdf(plan: OpsPlan) {
  try {
    const b64 = plan.pdfBase64 || "";
    const clean = b64.includes(",") ? b64.split(",")[1] : b64;
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    alert("Unable to open PDF — payload may be malformed.");
  }
}

export default function OpsPlanModal({
  plan,
  supervisorName,
  badge,
  onClose,
  onResolved,
}: Props) {
  const [name, setName] = useState(supervisorName);
  const [id, setId] = useState(badge);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<OpsPlan | null>(null);

  const sign = async () => {
    setBusy(true);
    const result = await dataService.signOpsPlan(plan, {
      signedBy: `${name} ${id}`.trim(),
      comments: comments.trim() || undefined,
    });
    setSigned(result);
    setBusy(false);
    onResolved(result);
  };

  const returnPlan = async () => {
    if (!comments.trim()) {
      alert("Returned plans require supervisor comments.");
      return;
    }
    setBusy(true);
    const result = await dataService.returnOpsPlan(plan, comments.trim());
    setBusy(false);
    onResolved(result);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="ops-id">{plan.id}</div>
            <h2 className="panel-title" style={{ marginTop: 4 }}>
              {plan.title}
            </h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <dl className="kv">
            <dt>Submitted by</dt>
            <dd>{plan.detective}</dd>
            <dt>Submitted</dt>
            <dd>{new Date(plan.submittedDate).toLocaleDateString()}</dd>
            <dt>Risk level</dt>
            <dd>
              <span className={`badge ${riskClass(plan.risk)}`}>{plan.risk}</span>
            </dd>
            <dt>Status</dt>
            <dd>{signed ? "Signed" : plan.status}</dd>
          </dl>

          <div className="section-label" style={{ margin: "0 0 8px" }}>
            Operational Summary
          </div>
          <div className="plan-summary">{plan.summary}</div>

          <div className="section-label" style={{ margin: "16px 0 8px" }}>
            Operations Plan Document
          </div>
          <div className="pdf-tile">
            <div className="pdf-icon">PDF</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff" }}>{plan.fileName || "operations-plan.pdf"}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {plan.pdfBase64
                  ? "One-page operations plan submitted for approval"
                  : "No PDF was attached to this submission"}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              disabled={!plan.pdfBase64}
              onClick={() => openPdf(plan)}
            >
              Open PDF
            </button>
          </div>

          {signed ? (
            <div className="signed-banner">
              <span>✓</span>
              <div>
                Signed by {signed.signedBy} ·{" "}
                {new Date(signed.signedAt!).toLocaleString()}
              </div>
            </div>
          ) : (
            <>
              <div className="section-label" style={{ margin: "0 0 8px" }}>
                Digital Sign-Off
              </div>
              <div className="sign-grid">
                <div className="field">
                  <label>Name</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Badge / ID</label>
                  <input
                    className="input"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Comments (optional for approval, required for return)</label>
                <textarea
                  className="input"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Add notes for the investigator…"
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          {signed ? (
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={returnPlan}
                disabled={busy}
              >
                Return for Revision
              </button>
              <button
                className="btn btn-primary"
                onClick={sign}
                disabled={busy}
              >
                {busy ? "Signing…" : "Sign & Approve"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
