import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { getIcacLocationLabel } from "./config";
import { loadIcacIndex, getTips, onIcacDataChange } from "./service";
import { deriveDashboard, type DashboardData, type HeatColumn } from "./derive";
import type { CyberTip } from "./types";
import ImportDialog from "./ImportDialog";
import { dataService } from "../data/service";

const DONUT_COLORS = ["#00b7c3", "#0078d4", "#ef5350", "#ffc107", "#4caf50", "#8b5cf6", "#ec4899"];

export default function Icac() {
  const [location, setLocation] = useState<string | null>(getIcacLocationLabel());
  const [tips, setTips] = useState<CyberTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [now, setNow] = useState(Date.now());

  const unit = dataService.getIdentity().unit || "Command Unit";

  useEffect(() => {
    let alive = true;
    setLocation(getIcacLocationLabel());
    loadIcacIndex(true)
      .then(() => { if (alive) { setTips(getTips()); setNow(Date.now()); } })
      .finally(() => { if (alive) setLoading(false); });
    const off = onIcacDataChange(() => { setTips([...getTips()]); setNow(Date.now()); });
    return () => { alive = false; off(); };
  }, []);

  const data = useMemo<DashboardData>(() => deriveDashboard(tips, now), [tips, now]);

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
      <Header unit={unit} location={location} onImport={() => setShowImport(true)} />

      {loading ? (
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

            <Panel title="Suspect Identifier Heatmap" meta="Cross-tip frequency">
              <Heatmap columns={data.heatmap} />
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

            <Panel title="Assignment Queue" meta="Phase 5 · LAN routing">
              <div className="icac-soon">
                <div className="ic-soon-n">{data.tiles.find((t) => t.key === "unassigned")?.value ?? 0}</div>
                <div className="ic-dim">unassigned tips ready to route to investigators</div>
                <div className="ic-soon-note">Assign → push CyberTip # over LAN → investigator acknowledges. Wired in Phase 5.</div>
              </div>
            </Panel>

            <Panel title="Export Center" meta="Phase 6">
              <div className="icac-export">
                {["CSV export", "Spreadsheet (.xlsx)", "JSON export"].map((x) => (
                  <div className="icac-export-row" key={x}>
                    <span>{x}</span>
                    <button className="btn btn-ghost" disabled>Export</button>
                  </div>
                ))}
                <div className="ic-soon-note">Export wiring arrives in Phase 6.</div>
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
    </>
  );
}

// --- small presentational helpers -----------------------------------------

const tooltipStyle = { background: "#1a1f27", border: "1px solid #262d38", borderRadius: 8, color: "#e0e0e0", fontSize: 12 };

function Header({ unit, location, onImport, importDisabled }: { unit: string; location: string | null; onImport: () => void; importDisabled?: boolean }) {
  return (
    <div className="topbar">
      <div>
        <h1 className="page-title">ICAC Supervisor Dashboard</h1>
        <div className="page-sub">Internet Crimes Against Children — Intelligence Center · {unit}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="icac-loc-chip">
          <span className="dot" style={{ background: location ? "var(--green)" : "var(--amber)", boxShadow: location ? "0 0 8px var(--green)" : "none" }} />
          {location || "No storage location"}
        </div>
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

function Heatmap({ columns }: { columns: HeatColumn[] }) {
  const max = Math.max(1, ...columns.flatMap((c) => c.cells.map((x) => x.count)));
  const has = columns.some((c) => c.cells.length);
  if (!has) return <Empty msg="No identifiers yet" />;
  return (
    <div className="icac-heat">
      {columns.map((col) => (
        <div className="icac-heat-col" key={col.type}>
          <div className="icac-heat-head">{col.type}</div>
          {Array.from({ length: 5 }).map((_, r) => {
            const cell = col.cells[r];
            const intensity = cell ? cell.count / max : 0;
            return (
              <div
                key={r}
                className="icac-heat-cell"
                title={cell ? `${cell.value} · ${cell.count} tips` : ""}
                style={{ background: cell ? `rgba(0,183,195,${0.15 + intensity * 0.6})` : "transparent", color: intensity > 0.55 ? "#08181a" : "#a0a0a0" }}
              >
                {cell ? cell.count : "·"}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function confChip(t: CyberTip): string {
  return t.parse_confidence === "high" ? "s-ok" : t.parse_confidence === "medium" ? "s-warn" : "s-read";
}
