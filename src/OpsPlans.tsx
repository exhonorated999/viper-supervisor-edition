import { useEffect, useState } from "react";
import type { OpsPlan } from "./types";
import type { SupervisorIdentity } from "./data/service";
import { dataService } from "./data/service";
import OpsPlanModal from "./OpsPlanModal";

const riskClass = (r: OpsPlan["risk"]) =>
  r === "High Risk" ? "high" : r === "Medium Risk" ? "medium" : "low";

const STATUS_COLOR: Record<OpsPlan["status"], string> = {
  Pending: "var(--amber, #f5a623)",
  Signed: "var(--green, #3fb950)",
  Returned: "var(--red, #f85149)",
};

export default function OpsPlans() {
  const [pending, setPending] = useState<OpsPlan[]>([]);
  const [resolved, setResolved] = useState<OpsPlan[]>([]);
  const [supervisor, setSupervisor] = useState<SupervisorIdentity | null>(null);
  const [modalPlan, setModalPlan] = useState<OpsPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    dataService.getPendingOpsPlans().then(setPending);
    dataService.getSignedOpsPlans().then((r) => {
      setResolved(r);
      setLoading(false);
    });
    dataService.getSupervisor().then(setSupervisor);
  };

  useEffect(() => {
    load();
    let wasConnected = dataService.lan.state === "connected";
    const offState = dataService.lan.onState((s) => {
      const now = s === "connected";
      if (now && !wasConnected) load();
      wasConnected = now;
    });
    const offEvent = dataService.lan.onEvent((e) => {
      if (e.kind === "delivery:new" && e.payload?.dtype === "opsPlan") load();
      else if (e.kind === "ops:new") load();
    });
    return () => {
      offState();
      offEvent();
    };
  }, []);

  const handleResolved = () => load();

  return (
    <>
      <div className="topbar">
        <h1 className="page-title">OPS Plans</h1>
      </div>

      {/* Pending approval */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <div className="panel-title">
            Pending Approval
            {pending.length > 0 && <span className="count-pill">{pending.length}</span>}
          </div>
        </div>
        {!loading && pending.length === 0 && (
          <div className="inbox-empty">No OPS plans awaiting approval.</div>
        )}
        {pending.map((p) => (
          <div className="ops-item" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <div className="ops-id">{p.id}</div>
              <div className="ops-title">{p.title}</div>
              <div className="ops-meta">
                <span>{p.detective}</span>
                <span>·</span>
                <span>{new Date(p.submittedDate).toLocaleDateString()}</span>
                <span className={`badge ${riskClass(p.risk)}`}>{p.risk}</span>
              </div>
              {p.summary && <div className="ops-summary-line">{p.summary}</div>}
            </div>
            <button className="btn btn-primary" onClick={() => setModalPlan(p)}>
              Review
            </button>
          </div>
        ))}
      </div>

      {/* Resolved (signed / returned) */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            Resolved
            {resolved.length > 0 && <span className="count-pill">{resolved.length}</span>}
          </div>
        </div>
        {!loading && resolved.length === 0 && (
          <div className="inbox-empty">No decisions recorded yet.</div>
        )}
        <table className="table">
          <tbody>
            {resolved.map((p) => (
              <tr key={p.id}>
                <td style={{ width: "1%", whiteSpace: "nowrap" }}>
                  <span
                    className="state-pill"
                    style={{ color: STATUS_COLOR[p.status], borderColor: STATUS_COLOR[p.status] }}
                  >
                    {p.status}
                  </span>
                </td>
                <td>
                  <div className="ops-title">{p.title}</div>
                  <div className="ops-meta">
                    <span className="ops-id">{p.id}</span>
                    <span>·</span>
                    <span>{p.detective}</span>
                    <span className={`badge ${riskClass(p.risk)}`}>{p.risk}</span>
                  </div>
                </td>
                <td style={{ color: "var(--text-dim)" }}>
                  {p.signedBy && <div>by {p.signedBy}</div>}
                  {p.signedAt && <div>{new Date(p.signedAt).toLocaleString()}</div>}
                  {p.comments && (
                    <div style={{ fontStyle: "italic", marginTop: 2 }}>“{p.comments}”</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalPlan && supervisor && (
        <OpsPlanModal
          plan={modalPlan}
          supervisorName={supervisor.name}
          badge={`Badge ${supervisor.badge}`}
          onClose={() => setModalPlan(null)}
          onResolved={handleResolved}
        />
      )}
    </>
  );
}
