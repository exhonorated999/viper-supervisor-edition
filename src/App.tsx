import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Inbox from "./Inbox";
import Settings from "./Settings";
import Cases from "./Cases";
import Investigators from "./Investigators";
import OpsPlans from "./OpsPlans";
import { dataService } from "./data/service";
import type { ConnState } from "./lan/client";
import {
  IconDashboard,
  IconCases,
  IconInvestigators,
  IconAssignments,
  IconOps,
  IconReports,
  IconSettings,
  IconCheckShield,
} from "./icons";

const IconInbox = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

type NavKey =
  | "Dashboard"
  | "Cases"
  | "Assignments"
  | "OPS Plans"
  | "Inbox"
  | "Investigators"
  | "Reports"
  | "Settings";

const NAV: { key: NavKey; icon: JSX.Element }[] = [
  { key: "Dashboard", icon: <IconDashboard /> },
  { key: "Cases", icon: <IconCases /> },
  { key: "Investigators", icon: <IconInvestigators /> },
  { key: "Assignments", icon: <IconAssignments /> },
  { key: "OPS Plans", icon: <IconOps /> },
  { key: "Inbox", icon: <IconInbox /> },
  { key: "Reports", icon: <IconReports /> },
  { key: "Settings", icon: <IconSettings /> },
  // Audit Log & Alerts Log live as tabs inside Settings
];

export default function App() {
  const [active, setActive] = useState<NavKey>("Dashboard");
  const [conn, setConn] = useState<ConnState>("idle");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    dataService.start();
    const off = dataService.lan.onState((s, info) => {
      setConn(s);
      setLastSync(info.lastSync);
      setQueued(info.queued);
    });
    // Initial unread count from the node inbox.
    dataService
      .getDeliveries()
      .then((d) => setUnread(d.filter((x) => x.status === "unread").length))
      .catch(() => {});
    // Live: incoming delivery → notification + unread bump.
    const offEvent = dataService.lan.onEvent((e) => {
      if (e.kind === "delivery:new") {
        setUnread((n) => n + 1);
        const d = e.payload || {};
        const what =
          d.dtype === "opsPlan"
            ? "OPS plan for approval"
            : d.dtype === "stats"
            ? "stats snapshot"
            : "case-status digest";
        setNotice(`Incoming ${what} from ${d.from || "an investigator"}`);
        setTimeout(() => setNotice(null), 6000);
      }
    });
    return () => {
      off();
      offEvent();
    };
  }, []);

  // Viewing the inbox clears the unread badge.
  useEffect(() => {
    if (active === "Inbox") setUnread(0);
  }, [active]);

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
              {item.key === "Inbox" && unread > 0 && (
                <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>
              )}
            </button>
          ))}
        </nav>

        <LanStatus conn={conn} lastSync={lastSync} queued={queued} />
      </aside>

      <main className="main">
        {active === "Dashboard" ? (
          <Dashboard />
        ) : active === "Inbox" ? (
          <Inbox />
        ) : active === "Settings" ? (
          <Settings />
        ) : active === "Cases" ? (
          <Cases />
        ) : active === "Investigators" ? (
          <Investigators />
        ) : active === "OPS Plans" ? (
          <OpsPlans />
        ) : (
          <Placeholder name={active} />
        )}
      </main>

      {notice && (
        <div className="delivery-notice" onClick={() => setActive("Inbox")}>
          <span className="dn-dot" />
          <div>
            <div className="dn-title">Incoming Delivery</div>
            <div className="dn-sub">{notice}</div>
          </div>
          <span className="dn-cta">View →</span>
        </div>
      )}
    </div>
  );
}

const CONN_META: Record<ConnState, { label: string; cls: string; pulse: boolean }> = {
  idle: { label: "Idle", cls: "", pulse: false },
  connecting: { label: "Connecting…", cls: "amber", pulse: true },
  handshaking: { label: "Handshake (P-256 mutual auth)…", cls: "amber", pulse: true },
  connected: { label: "Secure · Connected", cls: "good", pulse: true },
  offline: { label: "Offline · Reconnecting", cls: "red", pulse: false },
  untrusted: { label: "Untrusted · Check Settings", cls: "red", pulse: false },
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
      : conn === "offline" || conn === "untrusted"
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
        <span style={{ color: conn === "connected" ? "var(--green)" : conn === "offline" || conn === "untrusted" ? "var(--red)" : "var(--amber)" }}>
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
