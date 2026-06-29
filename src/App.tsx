import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import AuditLog from "./AuditLog";
import { dataService } from "./data/service";
import type { ConnState } from "./lan/client";
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
  const [conn, setConn] = useState<ConnState>("idle");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    dataService.start();
    const off = dataService.lan.onState((s, info) => {
      setConn(s);
      setLastSync(info.lastSync);
      setQueued(info.queued);
    });
    return off;
  }, []);

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

        <LanStatus conn={conn} lastSync={lastSync} queued={queued} />
      </aside>

      <main className="main">
        {active === "Dashboard" ? (
          <Dashboard />
        ) : active === "Audit Log" ? (
          <AuditLog />
        ) : (
          <Placeholder name={active} />
        )}
      </main>
    </div>
  );
}

const CONN_META: Record<ConnState, { label: string; cls: string; pulse: boolean }> = {
  idle: { label: "Idle", cls: "", pulse: false },
  connecting: { label: "Connecting…", cls: "amber", pulse: true },
  handshaking: { label: "Handshake (AES-256)…", cls: "amber", pulse: true },
  connected: { label: "Secure · Connected", cls: "good", pulse: true },
  offline: { label: "Offline · Reconnecting", cls: "red", pulse: false },
};

function LanStatus({
  conn,
  lastSync,
  queued,
}: {
  conn: ConnState;
  lastSync: number | null;
  queued: number;
}) {
  const m = CONN_META[conn];
  const dotColor =
    conn === "connected"
      ? "var(--green)"
      : conn === "offline"
      ? "var(--red)"
      : conn === "idle"
      ? "var(--text-faint)"
      : "var(--amber)";
  return (
    <div className="lan-status">
      <div className="lan-row">
        <span
          className={`dot${m.pulse ? " pulse" : ""}`}
          style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
        />
        <span className="lan-title">LAN Connection</span>
      </div>
      <div className="lan-row">
        <IconCheckShield
          size={14}
          style={{ color: conn === "connected" ? "var(--green)" : "var(--text-dim)" }}
        />
        <span style={{ color: conn === "connected" ? "var(--green)" : conn === "offline" ? "var(--red)" : "var(--amber)" }}>
          {m.label}
        </span>
      </div>
      <div className="lan-row">
        <span className="lan-sub">
          Last Sync:{" "}
          {lastSync ? new Date(lastSync).toLocaleTimeString() : "—"}
        </span>
      </div>
      {queued > 0 && (
        <div className="lan-row">
          <span className="lan-sub" style={{ color: "var(--amber)" }}>
            {queued} action{queued > 1 ? "s" : ""} queued (offline)
          </span>
        </div>
      )}
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
