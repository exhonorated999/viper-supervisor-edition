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
import {
  getManualInvestigators, addManualCase, onOffSystemChange,
  type ManualInvestigator,
} from "./data/offsystem";
import { deriveTrendFromCases, type TrendRange } from "./data/derive";
import type {
  Stats,
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  Alert,
  MetricKey,
} from "./types";
import OpsPlanModal from "./OpsPlanModal";
import StatCards from "./StatCards";
import QuickStats from "./QuickStats";
import { getCardPrefs, getQuickStats, onPrefsChange } from "./data/prefs";
import { generateReport, type ReportKind } from "./reports/generate";
import {
  IconChevron,
  IconRefresh,
  IconFolderOpen,
  IconFolderCheck,
  IconCuffs,
  IconWarrant,
  IconMoney,
  IconCalendar,
  IconBarChart,
  IconPie,
  IconAlerts,
  IconUserAlert,
  IconClock,
  IconCheckShield,
} from "./icons";

const DONUT_COLORS: Record<string, string> = {
  Open: "#0078D4",
  Ongoing: "#FFC107",
  Closed: "#4CAF50",
  Transferred: "#EF5350",
};

// Unit Overview trend window options
const RANGE_LABELS: Record<TrendRange, string> = {
  month: "This Month",
  quarter: "This Quarter",
  year: "This Year",
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
  const [metricValues, setMetricValues] = useState<Record<string, number>>({});
  const [cardPrefs, setCardPrefs] = useState<string[]>(() => getCardPrefs());

  const [selected, setSelected] = useState<MetricKey | null>(null);
  const [modalPlan, setModalPlan] = useState<OpsPlan | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [trendRange, setTrendRange] = useState<TrendRange>("month");
  const [rangeOpen, setRangeOpen] = useState(false);

  const loadAll = () => {
    dataService.getStats().then(setStats);
    dataService.getCases().then(setCases);
    dataService.getWorkload().then(setWorkload);
    dataService.getPendingOpsPlans().then(setPending);
    dataService.getSignedOpsPlans().then(setSigned);
    dataService.getAlerts().then(setAlerts);
    dataService.getSupervisor().then(setSupervisor);
    dataService.getMetricValues().then(setMetricValues);
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
        dataService.getMetricValues().then(setMetricValues);
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

  // Reflect card/quick-stats preference changes made from the gear menus.
  useEffect(() => onPrefsChange(() => setCardPrefs(getCardPrefs())), []);

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

  // The pushed stats snapshot has no time series, so synthesize the Unit
  // Overview trend from the case-status digest's dated activity. Fall back to
  // whatever trend the stats payload carried (usually empty).
  const trendData = useMemo(() => {
    const t = deriveTrendFromCases(cases, trendRange);
    return t.length ? t : stats?.trend ?? [];
  }, [cases, stats, trendRange]);

  const handleResolved = (plan: OpsPlan) => {
    if (plan.status === "Signed") {
      setPending((p) => p.filter((x) => x.id !== plan.id));
      setSigned((s) => [plan, ...s]);
    } else if (plan.status === "Returned") {
      setPending((p) => p.filter((x) => x.id !== plan.id));
    }
  };

  const runReport = async (kind: ReportKind) => {
    if (!stats || !supervisor) return;
    setFlash(`Generating ${kind === "ops" ? "OPS Plan Log" : kind} report…`);
    try {
      const name = await generateReport(kind, {
        supervisor: { name: supervisor.name, badge: supervisor.badge, unit: supervisor.unit },
        metricValues,
        cardKeys: cardPrefs,
        quickKeys: getQuickStats(),
        breakdown: stats.breakdown,
        totalCases: stats.totalCases,
        workload,
        cases,
        opsPending: pending,
        opsSigned: signed,
      });
      setFlash(`Report generated · ${name}`);
    } catch (e: any) {
      setFlash(`Report failed · ${String(e?.message || e)}`);
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
        <StatCards prefs={cardPrefs} values={metricValues} />
      </div>

      {/* ---------- QUICK STATS ---------- */}
      <div className="grid row rise" style={{ animationDelay: "90ms" }}>
        <QuickStats values={metricValues} />
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
                <div
                  className="unit-select"
                  style={{ padding: "6px 10px", fontSize: 12, position: "relative", cursor: "pointer", userSelect: "none" }}
                  onClick={() => setRangeOpen((o) => !o)}
                >
                  {RANGE_LABELS[trendRange]} <IconChevron size={14} />
                  {rangeOpen && (
                    <>
                      <div
                        className="dropdown-backdrop"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRangeOpen(false);
                        }}
                      />
                      <div className="unit-menu" onClick={(e) => e.stopPropagation()}>
                        {(Object.keys(RANGE_LABELS) as TrendRange[]).map((r) => (
                          <button
                            key={r}
                            className={`unit-menu-item${r === trendRange ? " active" : ""}`}
                            onClick={() => {
                              setTrendRange(r);
                              setRangeOpen(false);
                            }}
                          >
                            {RANGE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
            <button className="report-tile blue" onClick={() => runReport("monthly")}><IconBarChart /><div>Monthly Summary</div></button>
            <button className="report-tile green" onClick={() => runReport("ytd")}><IconCalendar /><div>YTD Overview</div></button>
            <button className="report-tile cyan" onClick={() => runReport("investigator")}><IconUserAlert /><div>Investigator Performance</div></button>
            <button className="report-tile amber" onClick={() => runReport("distribution")}><IconPie /><div>Case Distribution</div></button>
          </div>
          <button className="report-wide" onClick={() => runReport("ops")}><IconWarrant size={18} /> OPS Plan Log</button>
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
  // Composite selection: "" | "lan:<deviceId>" | "manual:<id>"
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [num, setNum] = useState("");
  const [online, setOnline] = useState<{ deviceId: string; name: string; badge?: string; unit?: string }[]>([]);
  const [manual, setManual] = useState<ManualInvestigator[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    dataService.getInvestigators().then((list) => { if (alive) setOnline(list); });
    const load = () => setManual(getManualInvestigators());
    load();
    const off = onOffSystemChange(load);
    return () => { alive = false; off(); };
  }, []);

  const submit = () => {
    if (!num || !assignee) {
      setToast("Case number and an assigned investigator are required.");
      return;
    }
    const caseNumber = num.trim();
    if (assignee.startsWith("lan:")) {
      // On-network investigator — push a notice to their Project V.I.P.E.R.,
      // and keep a local record so the supervisor can track it here too.
      const deviceId = assignee.slice(4);
      const inv = online.find((o) => o.deviceId === deviceId);
      const name = inv?.name || "Investigator";
      dataService.assignCase({
        caseNumber, description: desc, detective: name,
        priority, note: desc, assignedDate: date, to: deviceId,
      });
      addManualCase({
        case_number: caseNumber,
        title: desc || caseNumber,
        assignee_name: name,
        note: priority ? `Priority: ${priority}` : undefined,
        mode: "lan",
      });
      setToast(`Case ${caseNumber} assigned to ${name} — notice pushed to their Project V.I.P.E.R. device.`);
    } else {
      // Off-system investigator — track locally only, nothing crosses the LAN.
      const id = assignee.slice(7);
      const inv = manual.find((m) => m.id === id);
      addManualCase({
        case_number: caseNumber,
        title: desc || caseNumber,
        assignee_id: id,
        assignee_name: inv?.name,
        note: priority ? `Priority: ${priority}` : undefined,
        mode: "manual",
      });
      setToast(`Case ${caseNumber} assigned to ${inv?.name || "off-system investigator"} (off-system — tracked locally, nothing sent over the network).`);
    }
    setDesc(""); setNum(""); setAssignee(""); setPriority("");
  };

  return (
    <div className="panel col-5">
      <div className="panel-head">
        <div className="panel-title">Assign New Case</div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Case Number</label>
          <input className="input" value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. 26-99998" />
        </div>
        <div className="field">
          <label>Case Description</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Enter case description…" />
        </div>
        <div className="field">
          <label>Assign To</label>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Select investigator…</option>
            {online.length > 0 && (
              <optgroup label="● Online (Project V.I.P.E.R.)">
                {online.map((o) => (
                  <option key={`lan:${o.deviceId}`} value={`lan:${o.deviceId}`}>
                    {o.name}{o.badge ? ` · #${o.badge}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {manual.length > 0 && (
              <optgroup label="Off-System (manual)">
                {manual.map((m) => (
                  <option key={`manual:${m.id}`} value={`manual:${m.id}`}>
                    {m.name}{m.badge ? ` · #${m.badge}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {online.length === 0 && manual.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
              No investigators online or on file. Add off-system investigators in the Investigators view.
            </div>
          )}
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
