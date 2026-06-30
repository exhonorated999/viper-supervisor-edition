import type { CaseStatus, CaseActivityEvent } from "./types";

const LANE_META: Record<string, { label: string; color: string }> = {
  incident: { label: "Incident & Reports", color: "#f87171" },
  investigation: { label: "Investigative Actions", color: "#f59e0b" },
  forensics: { label: "Forensics & Evidence", color: "#10b981" },
  subject: { label: "Subject Activity", color: "#06b6d4" },
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
};

function Sparkline({ data }: { data: { week: string; count: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }}>
      {data.map((d) => (
        <div
          key={d.week}
          title={`${d.week}: ${d.count}`}
          style={{
            width: 10,
            height: `${Math.max(8, (d.count / max) * 40)}px`,
            background: "var(--cyan)",
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

export default function CaseActivityModal({
  caseItem,
  onClose,
}: {
  caseItem: CaseStatus;
  onClose: () => void;
}) {
  const act = caseItem.activity;
  const events: CaseActivityEvent[] = act?.events || [];
  const t = act?.totals;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div>
            <div className="ops-id">{caseItem.caseNumber}</div>
            <h2 className="panel-title" style={{ marginTop: 4 }}>
              Case Activity
            </h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {!act ? (
            <div className="inbox-empty">
              No activity feed for this case. The investigator hasn't pushed an
              activity-enabled digest yet.
            </div>
          ) : (
            <>
              <dl className="kv">
                <dt>Detective</dt>
                <dd>{caseItem.detective}</dd>
                <dt>Last activity</dt>
                <dd>{act.lastActivity ? fmtDate(act.lastActivity) : "—"}</dd>
                <dt>Total events</dt>
                <dd>{t?.total ?? events.length}</dd>
              </dl>

              {t && (
                <div className="activity-totals">
                  <div className="at-chip"><b>{t.warrants}</b> warrants</div>
                  <div className="at-chip"><b>{t.warrantsServed}</b> served</div>
                  <div className="at-chip"><b>{t.evidence}</b> evidence</div>
                  <div className="at-chip"><b>{t.reports}</b> reports</div>
                  <div className="at-chip"><b>{t.fieldwork}</b> fieldwork</div>
                </div>
              )}

              {act.cadence && act.cadence.length > 0 && (
                <>
                  <div className="section-label" style={{ margin: "14px 0 8px" }}>
                    Activity Cadence (last {act.cadence.length} weeks)
                  </div>
                  <Sparkline data={act.cadence} />
                </>
              )}

              <div className="section-label" style={{ margin: "16px 0 8px" }}>
                Activity Feed · metadata only (no case content)
              </div>
              {events.length === 0 ? (
                <div className="inbox-empty">No events recorded.</div>
              ) : (
                <ul className="activity-feed">
                  {events.map((e, i) => {
                    const lane = LANE_META[e.lane] || {
                      label: e.lane,
                      color: "var(--text-dim)",
                    };
                    return (
                      <li key={i} className="activity-row">
                        <span
                          className="activity-dot"
                          style={{
                            background: lane.color,
                            outline:
                              e.significance === "major"
                                ? `2px solid ${lane.color}55`
                                : "none",
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="activity-action">{e.action}</div>
                          <div className="activity-meta">
                            <span style={{ color: lane.color }}>{lane.label}</span>
                            <span>·</span>
                            <span>{fmtDate(e.date)}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
