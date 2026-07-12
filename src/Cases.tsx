import { useEffect, useMemo, useState } from "react";
import { dataService } from "./data/service";
import type { CaseStatus, CaseState } from "./types";
import CaseActivityModal from "./CaseActivityModal";
import ManualCaseDialog from "./ManualCaseDialog";
import {
  getManualCases, removeManualCase, onOffSystemChange, type ManualCase,
} from "./data/offsystem";

const STATE_COLORS: Record<CaseState, string> = {
  Open: "#0078D4",
  Ongoing: "#FFC107",
  Closed: "#4CAF50",
  Transferred: "#EF5350",
};

const FILTERS: Array<{ key: "all" | CaseState; label: string }> = [
  { key: "all", label: "All" },
  { key: "Open", label: "Open" },
  { key: "Ongoing", label: "Ongoing" },
  { key: "Closed", label: "Closed" },
  { key: "Transferred", label: "Transferred" },
];

export default function Cases() {
  const [cases, setCases] = useState<CaseStatus[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | CaseState>("all");
  const [active, setActive] = useState<CaseStatus | null>(null);
  const [manual, setManual] = useState<ManualCase[]>(() => getManualCases());
  const [editing, setEditing] = useState<ManualCase | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => dataService.getCases().then(setCases);

  useEffect(() => {
    load();
    const offOff = onOffSystemChange(() => setManual(getManualCases()));
    let wasConnected = dataService.lan.state === "connected";
    const offState = dataService.lan.onState((s) => {
      const now = s === "connected";
      if (now && !wasConnected) load();
      wasConnected = now;
    });
    const offEvent = dataService.lan.onEvent((e) => {
      if (e.kind === "delivery:new" && e.payload?.dtype === "caseStatus") load();
    });
    return () => {
      offOff();
      offState();
      offEvent();
    };
  }, []);

  const removeCase = (c: ManualCase) => {
    if (window.confirm(`Delete off-system case "${c.case_number || c.title}"?`)) removeManualCase(c.id);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (filter !== "all" && c.state !== filter) return false;
      if (!needle) return true;
      return (
        c.caseNumber.toLowerCase().includes(needle) ||
        c.detective.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle)
      );
    });
  }, [cases, q, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: cases.length };
    cases.forEach((x) => (c[x.state] = (c[x.state] || 0) + 1));
    return c;
  }, [cases]);

  return (
    <>
      <div className="topbar rise">
        <div>
          <h1 className="page-title">Cases</h1>
          <div className="page-sub">
            Read-only case records mirrored from investigator devices over the LAN.
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => setShowAdd(true)}>+ Off-System Case</button>
      </div>

      <div className="panel rise" style={{ animationDelay: "40ms", marginBottom: 18 }}>
        <div className="panel-head">
          <div className="panel-title">Assigned Cases</div>
          <span className="panel-meta">{manual.length} · tracked locally</span>
        </div>
        {manual.length === 0 ? (
          <div className="icac-panel-empty">
            None yet. Cases you assign from the Dashboard are tracked here — on-network
            ones also push a notice to the investigator's Project V.I.P.E.R.; off-system
            ones stay on this machine and never cross the network.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Case #</th><th>Title</th><th>Assigned To</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {manual.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.case_number || "—"}</td>
                  <td title={c.note || ""}>{c.title || "—"}</td>
                  <td>
                    {c.assignee_name || <span style={{ color: "var(--text-faint)" }}>Unassigned</span>}
                    <span className={`status-chip ${c.mode === "lan" ? "s-lan" : "s-manual"}`} style={{ marginLeft: 8 }}>
                      {c.mode === "lan" ? "on-network" : "off-system"}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-dim)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeCase(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel rise" style={{ animationDelay: "60ms" }}>
        <div
          className="panel-head"
          style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}
        >
          <div className="panel-title">
            Mirrored Cases <span className="count-pill">{cases.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`chip${filter === f.key ? " chip-active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {counts[f.key] != null && (
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>{counts[f.key]}</span>
                )}
              </button>
            ))}
            <input
              className="search-input"
              placeholder="Search case # / detective / synopsis…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Case #</th>
              <th>Detective</th>
              <th>State</th>
              <th>Priority</th>
              <th>Synopsis</th>
              <th>Activity</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  {cases.length === 0
                    ? "No cases yet. They appear here once an investigator pushes a case-status digest."
                    : "No cases match the current filter."}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr
                key={c.caseNumber}
                onClick={() => c.activity && setActive(c)}
                style={{ cursor: c.activity ? "pointer" : "default" }}
                title={c.activity ? "View case activity" : undefined}
              >
                <td style={{ fontWeight: 600 }}>{c.caseNumber}</td>
                <td>{c.detective}</td>
                <td>
                  <span
                    className="state-pill"
                    style={{
                      color: STATE_COLORS[c.state],
                      borderColor: STATE_COLORS[c.state] + "66",
                      background: STATE_COLORS[c.state] + "1a",
                    }}
                  >
                    {c.state}
                  </span>
                </td>
                <td>{c.caseType}</td>
                <td
                  style={{
                    maxWidth: 320,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "var(--text-dim)",
                  }}
                  title={c.description}
                >
                  {c.description || "—"}
                </td>
                <td>
                  {c.activity ? (
                    <span className="activity-badge" title="View case activity">
                      {c.activity.totals.total} events ›
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--text-dim)" }}>
                  {c.lastActivityDate
                    ? new Date(c.lastActivityDate).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <CaseActivityModal caseItem={active} onClose={() => setActive(null)} />
      )}

      {showAdd && (
        <ManualCaseDialog onClose={() => setShowAdd(false)} onDone={() => setManual(getManualCases())} />
      )}
      {editing && (
        <ManualCaseDialog existing={editing} onClose={() => setEditing(null)} onDone={() => setManual(getManualCases())} />
      )}
    </>
  );
}
