// ---------------------------------------------------------------------------
// Reports — build a briefing, preview it, export it, keep it.
//
// Three panes:
//   1. Builder   — report kind, time scope (dashboard presets OR a custom
//                  start/end range), investigator + case-state filters.
//   2. Preview   — the live, on-screen rendering of the exact payload that
//                  will be exported. Same object, so preview == file.
//   3. History   — every report generated on this machine, archived to
//                  IndexedDB so it can be re-opened or re-downloaded later.
//
// Everything is local. The supervisor only ever holds redacted metadata that
// investigators pushed over the LAN; no case content exists here to leak.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { dataService, type SupervisorIdentity } from "./data/service";
import type {
  CaseStatus,
  InvestigatorWorkload,
  OpsPlan,
  CaseBreakdownSlice,
  CaseState,
} from "./types";
import {
  emptyPeriodMetrics,
  periodLabel,
  PERIOD_ORDER,
  type PeriodKey,
  type PeriodMetrics,
} from "./data/periods";
import { getCardPrefs, getQuickStats } from "./data/prefs";
import { METRIC_CATALOG } from "./data/metrics";
import {
  defaultScope,
  resolveScope,
  toInputDate,
  type ReportScope,
} from "./reports/scope";
import {
  buildReportPayload,
  REPORT_KINDS,
  type ReportFilters,
  type ReportKind,
  type ReportPayload,
} from "./reports/payload";
import { exportReportPdf } from "./reports/generate";
import { exportReportHtml } from "./reports/html";
import {
  clearReports,
  deleteReport,
  downloadBlob,
  formatBytes,
  getReport,
  listReports,
  openBlob,
  saveReport,
  type ReportFormat,
  type ReportMeta,
} from "./reports/history";
import { IconRefresh, IconCheckShield } from "./icons";

const STATES: CaseState[] = ["Open", "Ongoing", "Closed", "Transferred"];

const STATE_COLORS: Record<string, string> = {
  Open: "#0078D4",
  Ongoing: "#FFC107",
  Closed: "#4CAF50",
  Transferred: "#EF5350",
};

type MetricSet = "cards" | "all";

export default function Reports() {
  // --- live unit data -------------------------------------------------------
  const [cases, setCases] = useState<CaseStatus[]>([]);
  const [workload, setWorkload] = useState<InvestigatorWorkload[]>([]);
  const [pending, setPending] = useState<OpsPlan[]>([]);
  const [signed, setSigned] = useState<OpsPlan[]>([]);
  const [breakdown, setBreakdown] = useState<CaseBreakdownSlice[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [periods, setPeriods] = useState<PeriodMetrics>(() => emptyPeriodMetrics());
  const [supervisor, setSupervisor] = useState<SupervisorIdentity | null>(null);

  // --- builder state --------------------------------------------------------
  const [kind, setKind] = useState<ReportKind>("unit");
  const [scope, setScope] = useState<ReportScope>(() => defaultScope());
  const [investigators, setInvestigators] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [metricSet, setMetricSet] = useState<MetricSet>("cards");

  // --- history / ui ---------------------------------------------------------
  const [history, setHistory] = useState<ReportMeta[]>([]);
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const loadAll = () => {
    dataService.getCases().then(setCases);
    dataService.getWorkload().then(setWorkload);
    dataService.getPendingOpsPlans().then(setPending);
    dataService.getSignedOpsPlans().then(setSigned);
    dataService.getMetricPeriods().then(setPeriods);
    dataService.getSupervisor().then(setSupervisor);
    dataService.getStats().then((s) => {
      setBreakdown(s?.breakdown ?? []);
      setTotalCases(s?.totalCases ?? 0);
    });
  };

  useEffect(() => {
    loadAll();
    listReports().then(setHistory).catch(() => {});
    // Refresh when an investigator pushes something new.
    const off = dataService.lan.onEvent((e) => {
      if (e.kind === "delivery:new" || e.kind === "case:activity") loadAll();
    });
    return off;
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  // Every investigator we know about, from either source.
  const allInvestigators = useMemo(() => {
    const set = new Set<string>();
    workload.forEach((w) => w.name && set.add(w.name));
    cases.forEach((c) => c.detective && set.add(c.detective));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [workload, cases]);

  const metricKeys = useMemo(() => {
    if (metricSet === "all") return METRIC_CATALOG.map((m) => m.key);
    const seen = new Set<string>();
    return [...getCardPrefs(), ...getQuickStats()].filter((k) =>
      seen.has(k) ? false : (seen.add(k), true)
    );
  }, [metricSet]);

  const resolved = useMemo(
    () => resolveScope(scope, periods.labels),
    [scope, periods.labels]
  );

  const filters: ReportFilters = useMemo(
    () => ({ investigators, states }),
    [investigators, states]
  );

  const payload: ReportPayload = useMemo(
    () =>
      buildReportPayload({
        kind,
        scope: resolved,
        filters,
        supervisor: {
          name: supervisor?.name,
          badge: supervisor?.badge,
          unit: supervisor?.unit,
        },
        periods,
        metricKeys,
        cases,
        workload,
        breakdown,
        totalCases,
        opsPending: pending,
        opsSigned: signed,
      }),
    [kind, resolved, filters, supervisor, periods, metricKeys, cases, workload, breakdown, totalCases, pending, signed]
  );

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const doExport = async (format: ReportFormat) => {
    setBusy(format);
    try {
      const out =
        format === "pdf" ? await exportReportPdf(payload) : await exportReportHtml(payload);
      downloadBlob(out.blob, out.filename);
      await saveReport({
        kind: payload.kind,
        format,
        title: payload.title,
        scopeLabel: payload.scope.label,
        filterLabel: payload.filterLabel,
        filename: out.filename,
        blob: out.blob,
      });
      setHistory(await listReports());
      setFlash(`${format.toUpperCase()} generated · ${out.filename}`);
    } catch (err) {
      setFlash(`Export failed — ${(err as Error)?.message || "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const reopen = async (id: string, download: boolean) => {
    const rec = await getReport(id);
    if (!rec) {
      setFlash("That report is no longer in the archive.");
      return;
    }
    if (download) downloadBlob(rec.blob, rec.filename);
    else openBlob(rec.blob);
  };

  const remove = async (id: string) => {
    await deleteReport(id);
    setHistory(await listReports());
  };

  const wipe = async () => {
    if (!confirm("Delete every archived report on this machine?")) return;
    await clearReports();
    setHistory([]);
    setFlash("Report archive cleared.");
  };

  return (
    <div className="reports-page">
      <div className="topbar">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            Build a briefing from mirrored unit data, preview it, then export a printable PDF or an
            interactive offline HTML file. Everything is generated and stored locally.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadAll} title="Re-read the latest pushed data">
          <IconRefresh /> Refresh data
        </button>
      </div>

      {flash && <div className="rep-flash">{flash}</div>}

      <div className="reports-grid">
        {/* ------------------------------------------------------- builder */}
        <section className="panel rep-builder">
          <div className="panel-head">
            <div className="panel-title">Builder</div>
          </div>

          <div className="rep-field">
            <label>Report</label>
            <div className="rep-kinds">
              {REPORT_KINDS.map((k) => (
                <button
                  key={k.kind}
                  className={`rep-kind${kind === k.kind ? " active" : ""}`}
                  onClick={() => setKind(k.kind)}
                  aria-pressed={kind === k.kind}
                >
                  <span className="rk-title">{k.title}</span>
                  <span className="rk-blurb">{k.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rep-field">
            <label>Period</label>
            <div className="rep-chips">
              {PERIOD_ORDER.map((p: PeriodKey) => (
                <button
                  key={p}
                  className={`chip${scope.mode === "preset" && scope.preset === p ? " chip-active" : ""}`}
                  aria-pressed={scope.mode === "preset" && scope.preset === p}
                  onClick={() => setScope({ ...scope, mode: "preset", preset: p })}
                >
                  {periodLabel(p, periods.labels)}
                </button>
              ))}
              <button
                className={`chip${scope.mode === "custom" ? " chip-active" : ""}`}
                aria-pressed={scope.mode === "custom"}
                onClick={() => setScope({ ...scope, mode: "custom" })}
              >
                Custom range
              </button>
            </div>
            {scope.mode === "custom" && (
              <div className="rep-dates">
                <label>
                  <span>From</span>
                  <input
                    type="date"
                    value={scope.start}
                    max={scope.end}
                    onChange={(e) => setScope({ ...scope, start: e.target.value })}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={scope.end}
                    min={scope.start}
                    max={toInputDate(new Date())}
                    onChange={(e) => setScope({ ...scope, end: e.target.value })}
                  />
                </label>
              </div>
            )}
            {!resolved.authoritative && (
              <p className="rep-note">
                Custom ranges have no investigator-computed bucket. Metric totals are withheld and
                the report relies on dated case activity instead.
              </p>
            )}
          </div>

          <div className="rep-field">
            <label>
              Metrics
              <span className="rep-count">{metricKeys.length}</span>
            </label>
            <div className="rep-chips">
              <button
                className={`chip${metricSet === "cards" ? " chip-active" : ""}`}
                aria-pressed={metricSet === "cards"}
                onClick={() => setMetricSet("cards")}
              >
                Dashboard selection
              </button>
              <button
                className={`chip${metricSet === "all" ? " chip-active" : ""}`}
                aria-pressed={metricSet === "all"}
                onClick={() => setMetricSet("all")}
              >
                Full catalog
              </button>
            </div>
          </div>

          <div className="rep-field">
            <label>
              Investigators
              <span className="rep-count">
                {investigators.length ? `${investigators.length} selected` : "all"}
              </span>
            </label>
            {allInvestigators.length ? (
              <div className="rep-chips">
                {allInvestigators.map((n) => (
                  <button
                    key={n}
                    className={`chip${investigators.includes(n) ? " chip-active" : ""}`}
                    aria-pressed={investigators.includes(n)}
                    onClick={() => toggle(investigators, n, setInvestigators)}
                  >
                    {n}
                  </button>
                ))}
                {investigators.length > 0 && (
                  <button className="chip rep-chip-clear" onClick={() => setInvestigators([])}>
                    Clear
                  </button>
                )}
              </div>
            ) : (
              <p className="rep-note">No investigators have reported in yet.</p>
            )}
          </div>

          <div className="rep-field">
            <label>
              Case state
              <span className="rep-count">{states.length ? `${states.length} selected` : "all"}</span>
            </label>
            <div className="rep-chips">
              {STATES.map((s) => (
                <button
                  key={s}
                  className={`chip${states.includes(s) ? " chip-active" : ""}`}
                  aria-pressed={states.includes(s)}
                  onClick={() => toggle(states, s, setStates)}
                  style={states.includes(s) ? { borderColor: STATE_COLORS[s] } : undefined}
                >
                  {s}
                </button>
              ))}
              {states.length > 0 && (
                <button className="chip rep-chip-clear" onClick={() => setStates([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="rep-actions">
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => doExport("pdf")}>
              {busy === "pdf" ? "Building…" : "Export PDF"}
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => doExport("html")}>
              {busy === "html" ? "Building…" : "Export interactive HTML"}
            </button>
          </div>
          <p className="rep-foot">
            <IconCheckShield /> Metadata only — no case narratives, evidence or media exist on this
            machine to export.
          </p>
        </section>

        {/* ------------------------------------------------------- preview */}
        <section className="panel rep-preview">
          <div className="panel-head">
            <div className="panel-title">Preview</div>
            <span className="rep-scope-tag">{payload.scope.label}</span>
          </div>
          <Preview p={payload} />
        </section>
      </div>

      {/* --------------------------------------------------------- history */}
      <section className="panel rep-history">
        <div className="panel-head">
          <div className="panel-title">
            Generated reports
            {history.length > 0 && <span className="count-pill">{history.length}</span>}
          </div>
          {history.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={wipe}>
              Clear archive
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="rep-empty">
            Nothing archived yet. Every report you export is kept here so you can re-open or
            re-download it without rebuilding.
          </p>
        ) : (
          <table className="rep-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>Scope</th>
                <th>Filter</th>
                <th>Generated</th>
                <th>Format</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.title}</td>
                  <td>{h.scopeLabel}</td>
                  <td className="dim">{h.filterLabel}</td>
                  <td className="dim">{new Date(h.createdAt).toLocaleString()}</td>
                  <td>
                    <span className={`fmt-pill ${h.format}`}>{h.format.toUpperCase()}</span>
                  </td>
                  <td className="dim">{formatBytes(h.size)}</td>
                  <td className="rep-row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => reopen(h.id, false)}>
                      Open
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => reopen(h.id, true)}>
                      Download
                    </button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(h.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview — a condensed on-screen rendering of the same payload the exporters
// consume. Intentionally shows the withheld (—) figures and the caveats, so
// the supervisor sees the limits of the document BEFORE distributing it.
// ---------------------------------------------------------------------------

function Preview({ p }: { p: ReportPayload }) {
  return (
    <div className="rep-doc">
      <div className="rep-doc-head">
        <h3>{p.title}</h3>
        <div className="rep-doc-meta">
          {p.scope.label} · {p.filterLabel} ·{" "}
          {new Date(p.generatedAt).toLocaleString()}
          {p.supervisor.name ? ` · ${p.supervisor.name}` : ""}
        </div>
      </div>

      {p.sections.map((id) => {
        if (id === "metrics") {
          return (
            <Block key={id} title="Unit Metrics">
              {p.metrics.length === 0 ? (
                <Empty>No metrics selected.</Empty>
              ) : (
                <div className="rep-metric-grid">
                  {p.metrics.map((m) => (
                    <div className="rep-metric" key={m.key} title={m.note || ""}>
                      <div className="rm-val">{m.value ?? "—"}</div>
                      <div className="rm-label">{m.label}</div>
                      <div className="rm-alt">All time {m.allTime}</div>
                    </div>
                  ))}
                </div>
              )}
            </Block>
          );
        }
        if (id === "activity") {
          const rows = p.activity.filter((a) => a.key !== "totalEvents");
          const max = Math.max(1, ...rows.map((r) => r.value));
          return (
            <Block key={id} title={`Case Activity — ${p.scope.label}`}>
              {rows.every((r) => r.value === 0) ? (
                <Empty>No dated case activity in this window.</Empty>
              ) : (
                <div className="rep-bars">
                  {rows.map((r) => (
                    <div className="rep-bar" key={r.key}>
                      <span className="rb-label">{r.label}</span>
                      <span className="rb-track">
                        <span className="rb-fill" style={{ width: `${(r.value / max) * 100}%` }} />
                      </span>
                      <span className="rb-val">{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </Block>
          );
        }
        if (id === "trend") {
          return (
            <Block key={id} title="Activity Trend">
              {p.series.length === 0 ? (
                <Empty>Not enough dated activity to plot a trend.</Empty>
              ) : (
                <Table
                  head={["Period", "Opened", "Closed", "Arrests", "Warrants"]}
                  rows={p.series.map((b) => [
                    b.label,
                    String(b.opened),
                    String(b.closed),
                    String(b.arrests),
                    String(b.warrants),
                  ])}
                />
              )}
            </Block>
          );
        }
        if (id === "breakdown") {
          return (
            <Block key={id} title="Case Status Breakdown">
              {p.breakdown.length === 0 ? (
                <Empty>No case-status data received yet.</Empty>
              ) : (
                <div className="rep-split">
                  {p.breakdown.map((b) => (
                    <div className="rep-split-row" key={b.state}>
                      <span className="rs-dot" style={{ background: STATE_COLORS[b.state] }} />
                      <span className="rs-label">{b.state}</span>
                      <span className="rs-track">
                        <span
                          className="rs-fill"
                          style={{ width: `${b.pct}%`, background: STATE_COLORS[b.state] }}
                        />
                      </span>
                      <span className="rs-val">
                        {b.count} <em>{b.pct}%</em>
                      </span>
                    </div>
                  ))}
                  <div className="rep-split-total">Total {p.totalCases}</div>
                </div>
              )}
            </Block>
          );
        }
        if (id === "workload") {
          return (
            <Block key={id} title="Investigator Workload">
              {p.workload.length === 0 ? (
                <Empty>No investigators reporting yet.</Empty>
              ) : (
                <Table
                  head={["Investigator", "Total", "Open", "Ongoing", "Aging", "New", "Band"]}
                  rows={p.workload.map((w) => [
                    w.name,
                    String(w.total),
                    String(w.open),
                    String(w.ongoing),
                    String(w.aging),
                    String(w.newMtd),
                    w.band,
                  ])}
                />
              )}
            </Block>
          );
        }
        if (id === "cases") {
          return (
            <Block key={id} title={`Cases (${p.cases.length})`}>
              {p.cases.length === 0 ? (
                <Empty>No cases match this scope and filter.</Empty>
              ) : (
                <Table
                  head={["Case", "Detective", "State", "Age", "Last Activity"]}
                  rows={p.cases.slice(0, 40).map((c) => [
                    c.caseNumber,
                    c.detective,
                    c.state,
                    `${c.ageDays}d`,
                    c.lastActivity,
                  ])}
                  note={p.cases.length > 40 ? `+ ${p.cases.length - 40} more in the export` : undefined}
                />
              )}
            </Block>
          );
        }
        if (id === "ops") {
          return (
            <Block key={id} title="OPS Plans">
              <Table
                head={["OPS ID", "Title", "Detective", "Status"]}
                rows={[...p.opsPending, ...p.opsSigned]
                  .slice(0, 40)
                  .map((o) => [o.id, o.title, o.detective, o.status])}
              />
              {p.opsPending.length + p.opsSigned.length === 0 && <Empty>No OPS plans yet.</Empty>}
            </Block>
          );
        }
        return null;
      })}

      {p.caveats.length > 0 && (
        <Block title="Notes on these figures">
          <ul className="rep-caveats">
            {p.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rep-block">
      <div className="rep-block-head">{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rep-empty">{children}</p>;
}

function Table({ head, rows, note }: { head: string[]; rows: string[][]; note?: string }) {
  return (
    <>
      <table className="rep-table compact">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="rep-note">{note}</p>}
    </>
  );
}
