import { useEffect, useState } from "react";
import { dataService, type AuditEntry } from "./data/service";

const RESULT_COLOR: Record<string, string> = {
  OK: "var(--green)",
  DENIED: "var(--red)",
};

export default function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await dataService.getAudit();
    setRows(r);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const runRbacTest = async () => {
    setTestMsg("Attempting forbidden action: action:case:edit …");
    const result = await dataService.attemptForbiddenEdit();
    setTestMsg(
      result === "RBAC_DENIED"
        ? "✓ Denied by node (RBAC_DENIED). Supervisors are read-only on case content. Logged below."
        : result === "LAN_OFFLINE"
        ? "Node offline — connect the LAN node to run this test."
        : `Result: ${result}`
    );
    setTimeout(load, 300);
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <div className="page-sub">
            Append-only record of supervisor actions over the LAN handshake (RFP §3.2)
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" onClick={runRbacTest}>
            Run RBAC Self-Test
          </button>
          <button className="btn btn-primary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {testMsg && (
        <div
          className="panel"
          style={{ marginBottom: 16, color: "var(--cyan)", fontSize: 13 }}
        >
          {testMsg}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Audit Trail</div>
          <span className="lan-sub">{rows.length} entries</span>
        </div>
        {loading ? (
          <div style={{ color: "var(--text-dim)", padding: "24px 0", textAlign: "center" }}>
            Loading audit trail…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--text-dim)", padding: "24px 0", textAlign: "center" }}>
            No audit entries yet. Connect the LAN node and perform a supervisor action.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num">{new Date(r.ts).toLocaleString()}</td>
                  <td>{r.actor}</td>
                  <td style={{ color: "var(--text-dim)" }}>{r.role}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.action}</td>
                  <td style={{ color: "var(--text-dim)" }}>{r.target || "—"}</td>
                  <td style={{ color: RESULT_COLOR[r.result] || "var(--text)", fontWeight: 600 }}>
                    {r.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
