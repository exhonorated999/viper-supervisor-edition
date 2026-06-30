import { useEffect, useState } from "react";
import { dataService } from "./data/service";
import type { InvestigatorWorkload } from "./types";

const BAND_COLOR: Record<string, string> = {
  High: "var(--red)",
  Balanced: "var(--green)",
  Light: "var(--cyan)",
};

export default function Investigators() {
  const [rows, setRows] = useState<InvestigatorWorkload[]>([]);

  const load = () => dataService.getWorkload().then(setRows);

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

  return (
    <>
      <div className="topbar rise">
        <div>
          <h1 className="page-title">Investigators</h1>
          <div className="page-sub">
            Caseload and workload by investigator, aggregated from pushed case-status digests.
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="panel rise" style={{ animationDelay: "60ms" }}>
          <div className="empty-state" style={{ padding: "40px 0", textAlign: "center" }}>
            No investigators reporting yet. They appear here once an investigator
            pushes a case-status digest from Project V.I.P.E.R.
          </div>
        </div>
      ) : (
        <>
          <div
            className="grid rise"
            style={{
              animationDelay: "60ms",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 16,
              marginBottom: 18,
            }}
          >
            {rows.map((w) => (
              <div className="panel" key={w.id} style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <span className="inv-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>
                    {w.initials}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{w.name}</div>
                    <span className={`band ${w.band}`} style={{ marginTop: 4, display: "inline-block" }}>
                      {w.band} workload
                    </span>
                  </div>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 26,
                      fontWeight: 700,
                      color: BAND_COLOR[w.band] || "var(--text)",
                    }}
                  >
                    {w.total}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <Stat label="Open" value={w.open} />
                  <Stat label="Ongoing" value={w.ongoing} />
                  <Stat label="Aging" value={w.aging} crit={w.aging > 0} />
                  <Stat label="New" value={w.newMtd} />
                </div>
              </div>
            ))}
          </div>

          <div className="panel rise" style={{ animationDelay: "120ms" }}>
            <div className="panel-head">
              <div className="panel-title">Workload Detail</div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Investigator</th>
                  <th>Total</th>
                  <th>Open</th>
                  <th>Ongoing</th>
                  <th>Aging</th>
                  <th>New</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div className="inv-cell">
                        <span className="inv-avatar">{w.initials}</span>
                        <span>{w.name}</span>
                      </div>
                    </td>
                    <td className="num">{w.total}</td>
                    <td className="num">{w.open}</td>
                    <td className="num">{w.ongoing}</td>
                    <td className={`num ${w.aging >= 5 ? "crit" : w.aging >= 3 ? "warn" : ""}`}>
                      {w.aging}
                    </td>
                    <td className="num">{w.newMtd}</td>
                    <td>
                      <span className={`band ${w.band}`}>{w.band}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, crit }: { label: string; value: number; crit?: boolean }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: crit ? "var(--red)" : "var(--text)",
        }}
      >
        {value}
      </div>
      <div style={{ color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".4px", fontSize: 10 }}>
        {label}
      </div>
    </div>
  );
}
