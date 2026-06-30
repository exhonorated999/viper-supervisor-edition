import { useEffect, useState } from "react";
import { dataService } from "./data/service";
import type { Alert } from "./types";

export default function AlertsLog() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setAlerts(await dataService.getAlerts());
    setLoading(false);
  };

  useEffect(() => {
    load();
    const offEvent = dataService.lan.onEvent((e) => {
      if (e.kind === "alert:new") setAlerts((a) => [e.payload, ...a]);
    });
    return () => offEvent();
  }, []);

  return (
    <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
      <div className="panel-head">
        <h2 className="panel-title">
          Alerts Log{alerts.length > 0 && <span className="count-pill">{alerts.length}</span>}
        </h2>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      {loading ? (
        <div className="inbox-empty" style={{ padding: "28px 12px" }}>Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div className="inbox-empty" style={{ padding: "28px 12px" }}>
          No alerts. Notifications appear here as investigators report case events over the LAN.
        </div>
      ) : (
        alerts.map((a) => (
          <div className={`alert-item ${a.severity}`} key={a.id}>
            <span className={`alert-icon ${a.severity}`} style={{ display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>
              {a.category.slice(0, 1)}
            </span>
            <div className="alert-main">
              <div className="alert-title">{a.title}</div>
              <div className="alert-detail">
                <span style={{ color: "var(--text-faint)" }}>{a.category}</span> · {a.detail}
              </div>
            </div>
            <span className="alert-time">{a.time}</span>
          </div>
        ))
      )}
    </div>
  );
}
