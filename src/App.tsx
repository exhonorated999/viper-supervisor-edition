import { useState } from "react";
import Dashboard from "./Dashboard";
import {
  IconDashboard,
  IconCases,
  IconInvestigators,
  IconAssignments,
  IconOps,
  IconAlerts,
  IconReports,
  IconSettings,
  IconAudit,
  IconCheckShield,
} from "./icons";

type NavKey =
  | "Dashboard"
  | "Cases"
  | "Assignments"
  | "OPS Plans"
  | "Investigators"
  | "Reports"
  | "Alerts Log"
  | "Settings";

const NAV: { key: NavKey; icon: JSX.Element }[] = [
  { key: "Dashboard", icon: <IconDashboard /> },
  { key: "Cases", icon: <IconCases /> },
  { key: "Investigators", icon: <IconInvestigators /> },
  { key: "Assignments", icon: <IconAssignments /> },
  { key: "OPS Plans", icon: <IconOps /> },
  { key: "Alerts Log", icon: <IconAlerts /> },
  { key: "Reports", icon: <IconReports /> },
  { key: "Settings", icon: <IconSettings /> },
  // Audit Log shown in mockup below Settings
];

export default function App() {
  const [active, setActive] = useState<NavKey | "Audit Log">("Dashboard");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M3 5l9 15 9-15" />
              <path d="M7 5l5 8 5-8" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-title">V.I.P.E.R.</div>
            <div className="brand-sub">Supervisor Edition</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item${active === item.key ? " active" : ""}`}
              onClick={() => setActive(item.key)}
            >
              {item.icon}
              <span>{item.key}</span>
            </button>
          ))}
          <button
            className={`nav-item${active === "Audit Log" ? " active" : ""}`}
            onClick={() => setActive("Audit Log")}
          >
            <IconAudit />
            <span>Audit Log</span>
          </button>
        </nav>

        <div className="lan-status">
          <div className="lan-row">
            <span className="dot pulse" />
            <span className="lan-title">LAN Connection</span>
          </div>
          <div className="lan-row">
            <IconCheckShield size={14} style={{ color: "var(--green)" }} />
            <span className="lan-good">Secure · Connected</span>
          </div>
          <div className="lan-row">
            <span className="lan-sub">Last Sync: 10:32:45 AM</span>
          </div>
          <div className="lan-row">
            <span className="lan-sub">04/22/2025</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {active === "Dashboard" ? (
          <Dashboard />
        ) : (
          <Placeholder name={active} />
        )}
      </main>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">{name}</h1>
          <div className="page-sub">Module scaffold — prototype focuses on the Supervisor Dashboard.</div>
        </div>
      </div>
      <div className="panel" style={{ minHeight: 320, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, color: "#fff", marginBottom: 6 }}>{name}</div>
          <div>This screen is part of the full Supervisor Edition build.</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>The Dashboard is the implemented reference screen.</div>
        </div>
      </div>
    </>
  );
}
