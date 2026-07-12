import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { getIcacLocationLabel } from "./config";
import { getIcacRole, onIcacConfigChange } from "./config";
import { loadIcacIndex, getTips, onIcacDataChange, reopenTips, getWarrants } from "./service";
import { deriveDashboard, type DashboardData } from "./derive";
import type { CyberTip } from "./types";
import { isClosed } from "./types";
import ImportDialog from "./ImportDialog";
import AssignDialog from "./AssignDialog";
import ExportDialog from "./ExportDialog";
import TipDetailModal from "./TipDetailModal";
import CloseDialog from "./CloseDialog";
import WarrantDialog from "./WarrantDialog";
import WarrantsDialog from "./WarrantsDialog";
import VaultGate from "./VaultGate";
import AuditDialog from "./AuditDialog";
import IdsTray from "./ids/IdsTray";
import { wireAssignmentEvents } from "./assign";
import { vaultState, onVaultChange, lock } from "./crypto/vault";
import { logAudit } from "./audit";
import { dataService } from "../data/service";

const DONUT_COLORS = ["#00b7c3", "#0078d4", "#ef5350", "#ffc107", "#4caf50", "#8b5cf6", "#ec4899"];

export default function Icac() {
  const [location, setLocation] = useState<string | null>(getIcacLocationLabel());
  const [tips, setTips] = useState<CyberTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [assignTip, setAssignTip] = useState<CyberTip | null>(null);
  const [detailTip, setDetailTip] = useState<CyberTip | null>(null);
  // Assignment Queue controls: closed-tip visibility, min-file filter, sort,
  // multi-select, and the bulk close-out dialog.
  const [showClosed, setShowClosed] = useState(false);
  const [minFiles, setMinFiles] = useState(0);
  const [filesSort, setFilesSort] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showClose, setShowClose] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showWarrants, setShowWarrants] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [vault, setVault] = useState(vaultState());
  const [role, setRole] = useState(getIcacRole());
  const [now, setNow] = useState(Date.now());

  const unit = dataService.getIdentity().unit || "Command Unit";
  const readonly = role === "readonly";

  useEffect(() => {
    let alive = true;
    setLocation(getIcacLocationLabel());
    const offAck = wireAssignmentEvents();
    const off = onIcacDataChange(() => { setTips([...getTips()]); setNow(Date.now()); });
    const offVault = onVaultChange(() => { if (alive) setVault(vaultState()); });
    const offCfg = onIcacConfigChange(() => { if (alive) { setRole(getIcacRole()); setLocation(getIcacLocationLabel()); } });
    return () => { alive = false; off(); offAck(); offVault(); offCfg(); };
  }, []);

  // Load (or reload) the store on mount and whenever the vault unlocks.
  // While locked, the gate renders instead — no load is attempted.
  useEffect(() => {
    if (vault === "locked") { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    loadIcacIndex(true)
      .then(() => { if (alive) { setTips(getTips()); setNow(Date.now()); } })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [vault]);

  const doLock = () => { lock(); void logAudit("vault.lock"); };

  const data = useMemo<DashboardData>(() => deriveDashboard(tips, now), [tips, now]);

  // Warrant number lookup for the queue chip. getWarrants() reads the live
  // index, which is refreshed (via onIcacDataChange → setTips) after any
  // warrant mutation, so keying on `tips` keeps this current.
  const warrantNumById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of getWarrants()) m.set(w.id, w.warrant_number);
    return m;
  }, [tips]);

  const queue = useMemo(() => {
    const rank = (t: CyberTip) => {
      if (!t.assignment?.assigned_to) return 0;                 // unassigned first
      if (t.assignment.status === "acknowledged") return 2;     // done last
      return 1;                                                 // sent / pending
    };
    let rows = tips.filter((t) => (showClosed ? true : !isClosed(t)));
    if (minFiles > 0) rows = rows.filter((t) => (t.contraband.file_count || 0) >= minFiles);
    return rows.sort((a, b) =>
      filesSort
        ? (b.contraband.file_count || 0) - (a.contraband.file_count || 0) ||
          (b.imported_at || "").localeCompare(a.imported_at || "")
        : rank(a) - rank(b) || (b.imported_at || "").localeCompare(a.imported_at || "")
    );
  }, [tips, showClosed, minFiles, filesSort]);

  // Selectable = visible open tips (closed tips are reopened individually).
  const selectableIds = useMemo(
    () => queue.filter((t) => !isClosed(t)).map((t) => t.id),
    [queue]
  );
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected]
  );
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelAll = () =>
    setSelected((prev) => {
      const all = selectableIds.every((id) => prev.has(id));
      return all ? new Set() : new Set(selectableIds);
    });
  const doReopen = (id: string) =>
    reopenTips([id]).then(() => { setTips([...getTips()]); setNow(Date.now()); });

  if (!location) {
    return (
      <>
        <Header unit={unit} location={location} onImport={() => {}} importDisabled />
        <div className="panel icac-empty">
          <div className="icac-empty-title">Choose where to store the ICAC database</div>
          <div className="icac-empty-sub">
            Open <b>Settings → Optional Modules → ICAC Processing</b> and pick a folder or USB drive.
            All CyberTip intelligence stays on this machine and never crosses the network.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        unit={unit}
        location={location}
        onImport={() => setShowImport(true)}
        importDisabled={readonly || vault === "locked"}
        role={role}
        vaultUnlocked={vault === "unlocked"}
        onLock={doLock}
        onAudit={() => setShowAudit(true)}
        onWarrants={() => setShowWarrants(true)}
        onConnect={vault === "locked" ? undefined : () => setShowIds(true)}
      />

      {vault === "locked" ? (
        <VaultGate onUnlocked={() => setVault(vaultState())} />
      ) : loading ? (
        <div className="panel icac-empty"><div className="icac-empty-sub">Loading intelligence database…</div></div>
      ) : (
        <div className="icac-dash">
          {/* Tier 1 — metric tiles */}
          <div className="icac-tiles">
            {data.tiles.map((t) => (
              <div className={`icac-tile tile-${t.key}`} key={t.key}>
                <div className="icac-tile-label">{t.label}</div>
                <div className="icac-tile-value">{t.value.toLocaleString()}</div>
                <div className="icac-tile-sub">{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Tier 2 — timeline / heatmap / provider intel */}
          <div className="icac-row cols-3">
            <Panel title="CyberTip Timeline" meta="Last 60 days">
              {data.timeline.length ? (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={data.timeline} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="icacTl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00b7c3" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#00b7c3" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#262d38" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#262d38" }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e0e0e0" }} />
                    <Area type="monotone" dataKey="count" stroke="#00b7c3" strokeWidth={2} fill="url(#icacTl)" name="CyberTips" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Empty msg="No dated tips in range" />}
            </Panel>

            <Panel title="High-Priority CyberTips" meta="By NCMEC category">
              {data.priorities.length ? (
                <div className="icac-table-wrap icac-scroll">
                  <table className="icac-table">
                    <thead><tr><th>CyberTip</th><th>Category</th><th>Media</th><th>Assigned</th></tr></thead>
                    <tbody>
                      {data.priorities.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <button className="tipd-link mono" onClick={() => { const t = tips.find((x) => x.id === p.id); if (t) setDetailTip(t); }} title="View extracted tip info">
                              {p.cybertip_number}
                            </button>
                            <div className="ic-dim">{p.provider}</div>
                          </td>
                          <td>
                            <span className={`sev-chip sev-${p.severity.toLowerCase()}`}>{p.code}</span>
                            <div className="ic-dim">{p.label}</div>
                          </td>
                          <td>{p.fileCount || "—"}</td>
                          <td className={p.assignedTo ? "" : "ic-dim"}>{p.assignedTo || "Unassigned"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty msg="No categorized tips yet" />}
            </Panel>

            <Panel title="Provider Intelligence" meta="By reporting ESP">
              {data.providers.length ? (
                <div className="icac-table-wrap">
                  <table className="icac-table">
                    <thead><tr><th>Provider</th><th>Tips</th><th>Status</th><th>Updated</th></tr></thead>
                    <tbody>
                      {data.providers.map((p) => (
                        <tr key={p.provider}>
                          <td><div className="mono" style={{ color: "#fff" }}>{p.provider}</div><div className="ic-dim">{p.dataTypes}</div></td>
                          <td>{p.count}</td>
                          <td><span className={`status-chip ${p.status === "Complete" ? "s-ok" : "s-warn"}`}>{p.status}</span></td>
                          <td className="ic-dim">{p.lastUpdate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty msg="No providers yet" />}
            </Panel>
          </div>

          {/* Tier 3 — linker / assignment (Phase 5) / export (Phase 6) */}
          <div className="icac-row cols-3">
            <Panel title="Repeat Suspect Linker" meta="Shared identifiers">
              {data.links.length ? (
                <div className="icac-table-wrap">
                  <table className="icac-table">
                    <thead><tr><th>Identifier</th><th>Type</th><th>Matches</th></tr></thead>
                    <tbody>
                      {data.links.map((l) => (
                        <tr key={l.type + l.value}>
                          <td className="mono ic-ellipsis" title={l.value}>{l.value}</td>
                          <td className="ic-dim">{l.type}</td>
                          <td><span className="ic-badge">{l.matches} tips</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty msg="No repeat suspects detected" />}
            </Panel>

            <Panel title="Assignment Queue" meta="LAN routing · cybertip # only">
              {tips.length ? (
                <>
                  <div className="icac-panel-toolbar">
                    <label className="icac-tb-field">
                      Min files
                      <input
                        type="number"
                        min={0}
                        value={minFiles}
                        onChange={(e) => setMinFiles(Math.max(0, Number(e.target.value) || 0))}
                        className="icac-tb-num"
                      />
                    </label>
                    <label className="icac-tb-check">
                      <input type="checkbox" checked={showClosed} onChange={(e) => { setShowClosed(e.target.checked); setSelected(new Set()); }} />
                      Show closed
                    </label>
                    <span className="icac-tb-spacer" />
                    {selectedIds.length > 0 && !readonly && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowAttach(true)}>
                          Attach warrant ({selectedIds.length})
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => setShowClose(true)}>
                          Close ({selectedIds.length})
                        </button>
                      </>
                    )}
                  </div>
                  <div className="icac-table-wrap">
                    <table className="icac-table">
                      <thead>
                        <tr>
                          <th className="icac-check-col">
                            <input
                              type="checkbox"
                              checked={selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))}
                              onChange={toggleSelAll}
                              disabled={readonly || selectableIds.length === 0}
                              aria-label="Select all"
                            />
                          </th>
                          <th>CyberTip</th>
                          <th>Assigned To</th>
                          <th className="icac-sortable" onClick={() => setFilesSort((s) => !s)} title="Sort by file count">
                            Files{filesSort ? " ▾" : ""}
                          </th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {queue.map((t) => {
                          const a = t.assignment;
                          const closed = isClosed(t);
                          const st = closed ? "closed" : !a?.assigned_to ? "unassigned" : (a.status || "sent");
                          const chip = closed ? "s-closed" : st === "acknowledged" ? "s-ok" : st === "sent" ? "s-warn" : st === "offsystem" ? "s-manual" : "s-read";
                          const stLabel = st === "offsystem" ? "off-system" : st;
                          const fc = t.contraband.file_count || 0;
                          return (
                            <tr key={t.id} className={closed ? "icac-row-closed" : ""}>
                              <td className="icac-check-col">
                                {!closed && (
                                  <input
                                    type="checkbox"
                                    checked={selected.has(t.id)}
                                    onChange={() => toggleSel(t.id)}
                                    disabled={readonly}
                                    aria-label="Select tip"
                                  />
                                )}
                              </td>
                              <td>
                                <button className="tipd-link mono" onClick={() => setDetailTip(t)} title="View extracted tip info">
                                  {t.cybertip_number || "—"}
                                </button>
                                {t.warrant_id && (
                                  <span className="icac-warrant-chip" title={`Covered by Wilson warrant #${warrantNumById.get(t.warrant_id) || "?"}`}>
                                    ⚖ #{warrantNumById.get(t.warrant_id) || "warrant"}
                                  </span>
                                )}
                              </td>
                              <td className="ic-dim ic-ellipsis" title={a?.assigned_to || ""}>{a?.assigned_to || "—"}</td>
                              <td>
                                {fc > 0 ? <span className={fc > 1 ? "icac-files-multi" : ""}>{fc}</span> : "—"}
                              </td>
                              <td>
                                <span className={`status-chip ${chip}`} title={closed ? `${t.disposition?.reason || "Closed"}${t.disposition?.note ? ` — ${t.disposition.note}` : ""}` : ""}>
                                  {closed ? (t.disposition?.reason || "closed") : stLabel}
                                </span>
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {closed ? (
                                  <button className="btn btn-ghost btn-sm" onClick={() => doReopen(t.id)} disabled={readonly}>Reopen</button>
                                ) : (
                                  <button className="btn btn-ghost btn-sm" onClick={() => setAssignTip(t)} disabled={readonly}>
                                    {a?.assigned_to ? "Reassign" : "Assign"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : <Empty msg="Import CyberTips to start assigning" />}
            </Panel>

            <Panel title="Export Center" meta="Local file · never LAN">
              <div className="icac-export">
                <div className="icac-export-lead">
                  Export the intelligence store for briefings, case files, or another
                  system. Choose format &amp; scope — everything stays on this machine.
                </div>
                <div className="icac-export-formats">
                  {[
                    { k: "csv", t: "CSV" },
                    { k: "xlsx", t: "XLSX" },
                    { k: "json", t: "JSON" },
                    { k: "pdf", t: "PDF" },
                  ].map((f) => (
                    <span className="icac-export-chip" key={f.k}>{f.t}</span>
                  ))}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowExport(true)}
                  disabled={!tips.length || readonly}
                >
                  Open Export Center
                </button>
                {!tips.length && <div className="ic-soon-note">Import CyberTips to enable export.</div>}
                {readonly && tips.length > 0 && <div className="ic-soon-note">Read-only access — export disabled.</div>}
              </div>
            </Panel>
          </div>

          {/* Tier 4 — recent / contraband donut / alerts */}
          <div className="icac-row cols-3">
            <Panel title="Recently Imported Tips" meta={`${data.total} total`}>
              {data.recent.length ? (
                <div className="icac-table-wrap">
                  <table className="icac-table">
                    <thead><tr><th>CyberTip</th><th>Provider</th><th>Media</th><th>Conf.</th></tr></thead>
                    <tbody>
                      {data.recent.map((t) => (
                        <tr key={t.id}>
                          <td className="mono" style={{ color: "#fff" }}>{t.cybertip_number || "—"}</td>
                          <td className="ic-dim">{t.provider}</td>
                          <td>{t.contraband.file_count}</td>
                          <td><span className={`status-chip ${confChip(t)}`}>{t.parse_confidence}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty msg="Nothing imported yet" />}
            </Panel>

            <Panel title="Top Contraband Categories" meta="ESP categorization">
              {data.donut.length ? (
                <div className="icac-donut">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={data.donut} dataKey="count" nameKey="label" innerRadius={45} outerRadius={72} paddingAngle={2} stroke="none">
                        {data.donut.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="icac-legend">
                    {data.donut.map((d, i) => (
                      <div className="ic-leg" key={d.code}>
                        <span className="ic-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="ic-leg-l">{d.code}</span>
                        <span className="ic-dim">{d.label}</span>
                        <span className="ic-leg-n">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Empty msg="No categorized media" />}
            </Panel>

            <Panel title="Alerts & Notifications" meta={`${data.alerts.length}`}>
              {data.alerts.length ? (
                <div className="icac-alerts">
                  {data.alerts.map((a) => (
                    <div className="icac-alert" key={a.id}>
                      <span className={`ic-alert-dot k-${a.kind}`} />
                      <div className="ic-alert-text">{a.text}</div>
                    </div>
                  ))}
                </div>
              ) : <Empty msg="No alerts" />}
            </Panel>
          </div>
        </div>
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onDone={() => { setTips([...getTips()]); setNow(Date.now()); }}
        />
      )}

      {assignTip && (
        <AssignDialog
          tip={assignTip}
          onClose={() => setAssignTip(null)}
          onDone={() => { setTips([...getTips()]); setNow(Date.now()); }}
        />
      )}

      {detailTip && (
        <TipDetailModal tip={detailTip} onClose={() => setDetailTip(null)} />
      )}

      {showClose && (
        <CloseDialog
          ids={selectedIds}
          by={dataService.getIdentity().name || unit}
          onClose={() => setShowClose(false)}
          onDone={() => { setTips([...getTips()]); setNow(Date.now()); setSelected(new Set()); }}
        />
      )}

      {showAttach && (
        <WarrantDialog
          tipIds={selectedIds}
          by={dataService.getIdentity().name || unit}
          onClose={() => setShowAttach(false)}
          onDone={() => { setTips([...getTips()]); setNow(Date.now()); setSelected(new Set()); }}
        />
      )}

      {showWarrants && (
        <WarrantsDialog
          onClose={() => setShowWarrants(false)}
          onChanged={() => { setTips([...getTips()]); setNow(Date.now()); }}
        />
      )}

      {showExport && (
        <ExportDialog
          tips={tips}
          unit={unit}
          onClose={() => setShowExport(false)}
        />
      )}

      {showAudit && <AuditDialog onClose={() => setShowAudit(false)} />}

      {showIds && (
        <IdsTray
          readonly={readonly}
          onClose={() => setShowIds(false)}
          onIngested={() => { loadIcacIndex(true).then(() => { setTips([...getTips()]); setNow(Date.now()); }).catch(() => {}); }}
        />
      )}
    </>
  );
}

// --- small presentational helpers -----------------------------------------

const tooltipStyle = { background: "#1a1f27", border: "1px solid #262d38", borderRadius: 8, color: "#e0e0e0", fontSize: 12 };

function Header({ unit, location, onImport, importDisabled, role, vaultUnlocked, onLock, onAudit, onWarrants, onConnect }: {
  unit: string; location: string | null; onImport: () => void; importDisabled?: boolean;
  role?: "command" | "readonly"; vaultUnlocked?: boolean; onLock?: () => void; onAudit?: () => void;
  onWarrants?: () => void; onConnect?: () => void;
}) {
  return (
    <div className="topbar">
      <div>
        <h1 className="page-title">ICAC Supervisor Dashboard</h1>
        <div className="page-sub">Internet Crimes Against Children — Intelligence Center · {unit}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {role === "readonly" && <span className="icac-role-chip">READ-ONLY</span>}
        <div className="icac-loc-chip">
          <span className="dot" style={{ background: location ? "var(--green)" : "var(--amber)", boxShadow: location ? "0 0 8px var(--green)" : "none" }} />
          {location || "No storage location"}
        </div>
        {onWarrants && <button className="btn btn-ghost" onClick={onWarrants} title="Wilson warrant registry">⚖️ Warrants</button>}
        {onAudit && <button className="btn btn-ghost" onClick={onAudit}>Audit Log</button>}
        {vaultUnlocked && onLock && <button className="btn btn-ghost" onClick={onLock} title="Lock the encrypted database">🔒 Lock</button>}
        {onConnect && <button className="btn btn-ghost icac-ids-btn" onClick={onConnect} title="Connect to the ICAC Data System">🌐 Connect to IDS</button>}
        <button className="btn btn-primary" onClick={onImport} disabled={importDisabled}>Import CyberTips</button>
      </div>
    </div>
  );
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="panel icac-panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="icac-panel-empty">{msg}</div>;
}

function confChip(t: CyberTip): string {
  return t.parse_confidence === "high" ? "s-ok" : t.parse_confidence === "medium" ? "s-warn" : "s-read";
}
