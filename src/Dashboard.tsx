import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { dataService, type SupervisorIdentity } from "./data/service";
import type {
  Stats,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  Alert,
  MetricKey,
} from "./types";
import OpsPlanModal from "./OpsPlanModal";
import {
  IconChevron,
  IconRefresh,
  IconFolderOpen,
  IconFolderCheck,
  IconCuffs,
  IconWarrant,
  IconMoney,
  IconGun,
  IconTransfer,
  IconCalendar,
  IconBarChart,
  IconPie,
  IconAlerts,
  IconUserAlert,
  IconClock,
  IconCheckShield,
} from "./icons";

const METRIC_META: Record<MetricKey, { icon: JSX.Element; accent: string }> = {
  casesOpened: { icon: <IconFolderOpen />, accent: "var(--blue)" },
  casesClosed: { icon: <IconFolderCheck />, accent: "var(--green)" },
  arrests: { icon: <IconCuffs />, accent: "var(--cyan)" },
  warrantsAuthored: { icon: <IconWarrant />, accent: "var(--amber)" },
  moneyRecovered: { icon: <IconMoney />, accent: "var(--green)" },
  gunsRecovered: { icon: <IconGun />, accent: "var(--red)" },
  transfers: { icon: <IconTransfer />, accent: "var(--cyan)" },
};

const DONUT_COLORS: Record<string, string> = {
  Open: "#0078D4",
  Ongoing: "#FFC107",
  Closed: "#4CAF50",
  Transferred: "#EF5350",
};

// which case-activity kind a metric card filters by
const METRIC_FILTER: Partial<Record<MetricKey, (c: CaseStatus) => boolean>> = {
  casesOpened: (c) => c.state === "Open",
  casesClosed: (c) => c.state === "Closed",
  arrests: (c) => c.lastActivityKind === "Arrest",
  warrantsAuthored: (c) => c.lastActivityKind === "Warrant",
  transfers: (c) => c.state === "Transferred",
  moneyRecovered: (c) => c.lastActivityKind === "Evidence",
  gunsRecovered: (c) => c.lastActivityKind === "Evidence",
};

// derive up-to-two-letter avatar initials from a display name
function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [cases, setCases] = useState<CaseStatus[]>([]);
  const [workload, setWorkload] = useState<InvestigatorWorkload[]>([]);
  const [pending, setPending] = useState<OpsPlan[]>([]);
  const [signed, setSigned] = useState<OpsPlan[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [supervisor, setSupervisor] = useState<SupervisorIdentity | null>(null);

  const [selected, setSelected] = useState<MetricKey | null>(null);
  const [modalPlan, setModalPlan] = useState<OpsPlan | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const loadAll = () => {
    dataService.getStats().then(setStats);
    dataService.getCases().then(setCases);
    dataService.getWorkload().then(setWorkload);
    dataService.getPendingOpsPlans().then(setPending);
    dataService.getSignedOpsPlans().then(setSigned);
    dataService.getAlerts().then(setAlerts);
    dataService.getSupervisor().then(setSupervisor);
    setLastSync(Date.now());
  };

  useEffect(() => {
    loadAll();
    // Re-sync only on the *transition* into connected (first connect or after a
    // drop) — NOT on every sync tick. Otherwise the whole dashboard re-renders
    // (and replays its entrance animations) on each RPC/heartbeat, which reads
    // as a distracting periodic refresh. Live data arrives via onEvent below.
    let wasConnected = dataService.lan.state === "connected";
    const offState = dataService.lan.onState((s) => {
      const nowConnected = s === "connected";
      if (nowConnected && !wasConnected) loadAll();
      wasConnected = nowConnected;
    });
    // Real-time push events from investigator devices.
    const offEvent = dataService.lan.onEvent((e) => {
      if (e.kind === "ops:new") {
        setPending((p) => [e.payload, ...p.filter((x) => x.id !== e.payload.id)]);
        setFlash(`New OPS plan received · ${e.payload.id} (${e.payload.risk})`);
      } else if (e.kind === "case:activity") {
        setCases((c) => [e.payload, ...c.filter((x) => x.caseNumber !== e.payload.caseNumber)]);
        setFlash(`Live case activity · ${e.payload.caseNumber} — ${e.payload.lastActivity}`);
      } else if (e.kind === "alert:new") {
        setAlerts((a) => [e.payload, ...a]);
        setFlash(`New alert · ${e.payload.title}`);
      } else if (e.kind === "delivery:new") {
        // An investigator pushed a stats / case-status snapshot — refresh the
        // dashboard so the delivered data populates the cards and charts.
        const d = e.payload;
        dataService.getStats().then(setStats);
        dataService.getCases().then(setCases);
        dataService.getWorkload().then(setWorkload);
        setLastSync(Date.now());
        if (d?.dtype === "stats") {
          setFlash(`Stats snapshot received · ${d.from || "investigator"}`);
        } else if (d?.dtype === "caseStatus") {
          setFlash(`Case-status digest received · ${d.from || "investigator"}`);
        } else if (d?.dtype === "opsPlan") {
          dataService.getPendingOpsPlans().then(setPending);
          dataService.getSignedOpsPlans().then(setSigned);
          setFlash(`OPS plan received for approval · ${d.from || "investigator"}`);
        }
      }
    });
    return () => {
      offState();
      offEvent();
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  const filteredCases = useMemo(() => {
    if (!selected) return cases;
    const f = METRIC_FILTER[selected];
    return f ? cases.filter(f) : cases;
  }, [cases, selected]);

  const handleResolved = (plan: OpsPlan) => {
    if (plan.status === "Signed") {
      setPending((p) => p.filter((x) => x.id !== plan.id));
      setSigned((s) => [plan, ...s]);
    } else if (plan.status === "Returned") {
      setPending((p) => p.filter((x) => x.id !== plan.id));
    }
  };

  if (!stats || !supervisor) {
    return (
      <div className="panel" style={{ minHeight: 400, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        Establishing LAN sync…
      </div>
    );
  }

  return (
    <>
      {flash && <div className="live-toast">{flash}</div>}
      {/* ---------- TOP BAR ---------- */}
      <div className="topbar rise">
        <div>
          <h1 className="page-title">Supervisor Dashboard</h1>
          <div className="page-sub">Real-time overview of unit activity and performance</div>
        </div>
        <button className="unit-select">
          <span>🏛</span>
          <span>{supervisor.unit || "Unit not set"}</span>
          <IconChevron size={16} />
        </button>
        <div className="supervisor">
          <div className="supervisor-meta">
            <div className="supervisor-name">{supervisor.name || "Unregistered"}</div>
            <div className="supervisor-badge">
              {supervisor.badge ? `Badge ${supervisor.badge}` : "Set identity in Settings"}
            </div>
          </div>
          <div className="avatar">
            {initials(supervisor.name)}<span className="status-dot" />
          </div>
        </div>
      </div>

      {/* ---------- METRIC CARDS ---------- */}
      <div className="section-label">
        <span>Month to Date&nbsp;&nbsp;·&nbsp;&nbsp;Year to Date</span>
        <span className="last-updated">
          <IconRefresh size={14} /> Last Updated:{" "}
          {lastSync ? new Date(lastSync).toLocaleTimeString() : "—"}
        </span>
      </div>
      <div className="metric-row rise" style={{ animationDelay: "60ms" }}>
        {stats.metrics.length === 0 ? (
          <div className="panel empty-state">
            No unit metrics yet. Stats appear here once an investigator pushes a
            stats snapshot from Project V.I.P.E.R.
          </div>
        ) : (
        <div className="grid">
          {stats.metrics.map((m) => {
            const meta = METRIC_META[m.key];
            return (
              <button
                key={m.key}
                className={`metric-card${selected === m.key ? " selected" : ""}`}
                style={{ ["--accent" as string]: meta.accent }}
                onClick={() => setSelected((s) => (s === m.key ? null : m.key))}
              >
                <div className="metric-head">
                  <span className="metric-icon">{meta.icon}</span>
                  <span>{m.label}</span>
                </div>
                <div className="metric-value">{m.value}</div>
                <div className="metric-delta">
                  <span className="arrow">{m.deltaDirection === "up" ? "▲" : "▼"}</span>
                  <span className="pct">{m.delta}</span>
                  <span>{m.comparison}</span>
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* ---------- MID SECTION ---------- */}
      <div className="grid row rise" style={{ animationDelay: "120ms" }}>
        {/* Unit overview + breakdown */}
        <div className="panel col-8">
          <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20 }}>
            <div>
              <div className="panel-head">
                <div className="panel-title">
                  <IconBarChart size={16} /> Unit Overview
                </div>
                <button className="unit-select" style={{ padding: "6px 10px", fontSize: 12 }}>
                  This Month <IconChevron size={14} />
                </button>
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={stats.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#232a34" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ stroke: "#3a4452" }} />
                  <Line type="monotone" dataKey="casesOpened" name="Cases Opened" stroke="#0078D4" strokeWidth={2.5} dot={{ r: 3, fill: "#0078D4" }} animationDuration={1000} />
                  <Line type="monotone" dataKey="casesClosed" name="Cases Closed" stroke="#4CAF50" strokeWidth={2.5} dot={{ r: 3, fill: "#4CAF50" }} animationDuration={1000} />
                  <Line type="monotone" dataKey="arrests" name="Arrests" stroke="#B47CFF" strokeWidth={2.5} dot={{ r: 3, fill: "#B47CFF" }} animationDuration={1000} />
                </LineChart>
              </ResponsiveContainer>
              <div className="legend-inline" style={{ justifyContent: "center" }}>
                <span><i className="legend-swatch" style={{ background: "#0078D4" }} /> Cases Opened</span>
                <span><i className="legend-swatch" style={{ background: "#4CAF50" }} /> Cases Closed</span>
                <span><i className="legend-swatch" style={{ background: "#B47CFF" }} /> Arrests</span>
              </div>
            </div>

            <div>
              <div className="panel-head">
                <div className="panel-title">
                  <IconPie size={16} /> Case Status Breakdown
                </div>
              </div>
              <div className="donut-wrap">
                {stats.breakdown.length === 0 ? (
                  <div className="empty-state" style={{ width: "100%" }}>
                    No case data yet.
                  </div>
                ) : (<>
                <div className="donut-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.breakdown}
                        dataKey="count"
                        nameKey="state"
                        innerRadius={56}
                        outerRadius={80}
                        paddingAngle={2}
                        stroke="none"
                        animationDuration={900}
                      >
                        {stats.breakdown.map((s) => (
                          <Cell key={s.state} fill={DONUT_COLORS[s.state]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center">
                    <div>
                      <div className="donut-total">{stats.totalCases}</div>
                      <div className="donut-total-label">Total Cases</div>
                    </div>
                  </div>
                </div>
                <div className="legend">
                  {stats.breakdown.map((s) => (
                    <div className="legend-item" key={s.state}>
                      <span className="legend-swatch" style={{ background: DONUT_COLORS[s.state] }} />
                      <span className="legend-name">{s.state}</span>
                      <span className="legend-val">{s.count} ({s.pct}%)</span>
                    </div>
                  ))}
                </div>
                </>)}
              </div>
            </div>
          </div>
        </div>

        {/* OPS plans pending */}
        <div className="panel col-4">
          <div className="panel-head">
            <div className="panel-title">
              OPS Plans Pending Approval
              {pending.length > 0 && <span className="count-pill">{pending.length}</span>}
            </div>
            <button className="panel-link">View All</button>
          </div>
          {pending.length === 0 && (
            <div style={{ color: "var(--text-dim)", padding: "20px 0", textAlign: "center" }}>
              No plans awaiting approval.
            </div>
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
                  <span className={`badge ${p.risk === "High Risk" ? "high" : p.risk === "Medium Risk" ? "medium" : "low"}`}>
                    {p.risk}
                  </span>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => setModalPlan(p)}>
                Review
              </button>
            </div>
          ))}
          <button className="btn-block">View All OPS Plans</button>
        </div>
      </div>

      {/* ---------- WORKLOAD / ACTIVITY / ALERTS ---------- */}
      <div className="grid row rise" style={{ animationDelay: "180ms" }}>
        {/* Investigator workload */}
        <div className="panel col-5">
          <div className="panel-head">
            <div className="panel-title">Investigator Workload</div>
            <button className="panel-link">View All Investigators</button>
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
              {workload.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No investigators reporting yet.
                  </td>
                </tr>
              )}
              {workload.map((w) => (
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
                  <td className={`num ${w.aging >= 5 ? "crit" : w.aging >= 3 ? "warn" : ""}`}>{w.aging}</td>
                  <td className="num">{w.newMtd}</td>
                  <td><span className={`band ${w.band}`}>{w.band}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="legend-inline">
            <span><i className="legend-swatch" style={{ background: "var(--red)" }} /> High Workload</span>
            <span><i className="legend-swatch" style={{ background: "var(--green)" }} /> Balanced</span>
            <span><i className="legend-swatch" style={{ background: "var(--cyan)" }} /> Light Workload</span>
          </div>
        </div>

        {/* Recent activity */}
        <div className="panel col-4">
          <div className="panel-head">
            <div className="panel-title">Recent Case Activity</div>
            <button className="panel-link">View All Cases</button>
          </div>
          {selected && (
            <div style={{ fontSize: 12, color: "var(--cyan)", marginBottom: 8 }}>
              Filtered by selected metric · {filteredCases.length} match(es) ·{" "}
              <button className="panel-link" style={{ fontSize: 12 }} onClick={() => setSelected(null)}>clear</button>
            </div>
          )}
          {filteredCases.length === 0 && (
            <div className="empty-state">No recent case activity.</div>
          )}
          {filteredCases.slice(0, 6).map((c) => {
            const kind = c.lastActivityKind === "New Case" ? "New" : c.lastActivityKind;
            return (
              <div className="activity-item" key={c.caseNumber}>
                <span className={`activity-icon tag ${kind}`} style={{ borderRadius: 8 }}>
                  <ActivityGlyph kind={c.lastActivityKind} />
                </span>
                <div className="activity-main">
                  <div className="activity-case">{c.caseNumber}</div>
                  <div className="activity-sub">{c.detective} · {new Date(c.lastActivityDate).toLocaleDateString()}</div>
                </div>
                <span className={`tag ${kind}`}>{c.lastActivity}</span>
              </div>
            );
          })}
          <button className="btn-block">View All Activity</button>
        </div>

        {/* Alerts */}
        <div className="panel col-3">
          <div className="panel-head">
            <div className="panel-title">Alerts &amp; Notifications</div>
            <button className="panel-link">View All</button>
          </div>
          {alerts.length === 0 && (
            <div className="empty-state">No alerts.</div>
          )}
          {alerts.map((a) => (
            <div className={`alert-item ${a.severity}`} key={a.id}>
              <span className={`alert-icon ${a.severity}`}>
                <AlertGlyph category={a.category} />
              </span>
              <div className="alert-main">
                <div className="alert-title">{a.title}</div>
                <div className="alert-detail">{a.detail}</div>
              </div>
              <span className="alert-time">{a.time}</span>
            </div>
          ))}
          <button className="btn-block">Configure Alerts</button>
        </div>
      </div>

      {/* ---------- ASSIGN / REPORTS / SIGN-OFFS ---------- */}
      <div className="grid row rise" style={{ animationDelay: "240ms" }}>
        <AssignCase />

        {/* Quick reports */}
        <div className="panel col-4">
          <div className="panel-head">
            <div className="panel-title">Quick Reports</div>
          </div>
          <div className="report-grid">
            <button className="report-tile blue"><IconBarChart /><div>Monthly Summary</div></button>
            <button className="report-tile green"><IconCalendar /><div>YTD Overview</div></button>
            <button className="report-tile cyan"><IconUserAlert /><div>Investigator Performance</div></button>
            <button className="report-tile amber"><IconPie /><div>Case Distribution</div></button>
          </div>
          <button className="report-wide"><IconWarrant size={18} /> OPS Plan Log</button>
        </div>

        {/* Digital sign-offs */}
        <div className="panel col-3">
          <div className="panel-head">
            <div className="panel-title">Digital Sign-Offs (Recent)</div>
            <button className="panel-link">View All</button>
          </div>
          {signed.length === 0 && (
            <div style={{ color: "var(--text-dim)", padding: "20px 0", textAlign: "center" }}>No sign-offs yet.</div>
          )}
          {signed.slice(0, 3).map((s) => (
            <div className="signoff" key={s.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="signoff-id">{s.id}</span>
                <span className="badge signed">Signed</span>
              </div>
              <div className="signoff-title">{s.title}</div>
              <div className="signoff-by">
                Signed by: {s.signedBy}
                <br />
                {s.signedAt && new Date(s.signedAt).toLocaleString()}
              </div>
              <div className="signature">{signatureFor(s.signedBy)}</div>
            </div>
          ))}
        </div>
      </div>

      {modalPlan && (
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

function signatureFor(name?: string) {
  if (!name) return "—";
  // initials-style scripted signature
  const parts = name.replace(/Badge.*/, "").trim().split(/\s+/);
  return parts.map((p) => p[0]).join(".") + ".";
}

function ActivityGlyph({ kind }: { kind: CaseStatus["lastActivityKind"] }) {
  switch (kind) {
    case "Arrest": return <IconCuffs size={16} />;
    case "Warrant": return <IconWarrant size={16} />;
    case "Evidence": return <IconCheckShield size={16} />;
    case "Closed": return <IconFolderCheck size={16} />;
    default: return <IconFolderOpen size={16} />;
  }
}

function AlertGlyph({ category }: { category: Alert["category"] }) {
  switch (category) {
    case "OPS Approval": return <IconAlerts size={16} />;
    case "Aging Cases": return <IconClock size={16} />;
    case "Workload": return <IconUserAlert size={16} />;
    case "Overdue Tasks": return <IconClock size={16} />;
    case "Recovery": return <IconMoney size={16} />;
    default: return <IconAlerts size={16} />;
  }
}

function AssignCase() {
  const [desc, setDesc] = useState("");
  const [investigator, setInvestigator] = useState("");
  const [priority, setPriority] = useState("");
  const [date, setDate] = useState("2025-04-22");
  const [num, setNum] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const submit = () => {
    if (!num || !investigator) {
      setToast("Case number and assigned detective are required.");
      return;
    }
    const caseNumber = `MC-2025-${num}`;
    dataService.assignCase({
      caseNumber,
      description: desc,
      detective: investigator,
      priority,
      assignedDate: date,
    });
    setToast(`Case ${caseNumber} assigned to ${investigator}. Pushed to investigator device over LAN.`);
    setDesc(""); setNum(""); setInvestigator(""); setPriority("");
  };

  return (
    <div className="panel col-5">
      <div className="panel-head">
        <div className="panel-title">Assign New Case</div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Case Number</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>MC-2025-</span>
            <input className="input" style={{ width: "100%" }} value={num} onChange={(e) => setNum(e.target.value)} placeholder="____" />
          </div>
        </div>
        <div className="field">
          <label>Case Description</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Enter case description…" />
        </div>
        <div className="field">
          <label>Assign To</label>
          <input className="input" value={investigator} onChange={(e) => setInvestigator(e.target.value)} placeholder="Investigator name…" />
        </div>
        <div className="field">
          <label>Priority</label>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Select Priority</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div className="field">
          <label>Assigned Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={submit}>Create Case</button>
      </div>
      {toast && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--cyan)" }}>{toast}</div>
      )}
    </div>
  );
}
