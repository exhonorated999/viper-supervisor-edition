import { useEffect, useMemo, useState } from "react";
import { dataService } from "./data/service";
import type { CaseStatus, CaseState } from "./types";

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

  const load = () => dataService.getCases().then(setCases);

  useEffect(() => {
    load();
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
      offState();
      offEvent();
    };
  }, []);

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
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {cases.length === 0
                    ? "No cases yet. They appear here once an investigator pushes a case-status digest."
                    : "No cases match the current filter."}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.caseNumber}>
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
                    maxWidth: 360,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "var(--text-dim)",
                  }}
                  title={c.description}
                >
                  {c.description || "—"}
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
    </>
  );
}
