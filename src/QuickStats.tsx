import { useState } from "react";
import { METRIC_CATALOG, metricDef, formatMetricValue } from "./data/metrics";
import { getQuickStats, setQuickStats, QUICK_STATS_COUNT } from "./data/prefs";
import { IconSettings } from "./icons";

// "Configure Quick Stats" modal — pick exactly 4 metrics from the catalog.
function ConfigureModal({
  initial,
  onSave,
  onClose,
}: {
  initial: string[];
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [warn, setWarn] = useState<string | null>(null);

  const toggle = (key: string) => {
    setWarn(null);
    setSel((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length >= QUICK_STATS_COUNT) {
        setWarn(`You can only select ${QUICK_STATS_COUNT} metrics for Quick Stats.`);
        return cur;
      }
      return [...cur, key];
    });
  };

  const save = () => {
    if (sel.length !== QUICK_STATS_COUNT) {
      setWarn(`Please select exactly ${QUICK_STATS_COUNT} metrics.`);
      return;
    }
    onSave(sel);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="panel-title" style={{ color: "var(--cyan)" }}>Configure Quick Stats</div>
            <div className="page-sub" style={{ marginTop: 4 }}>
              Select {QUICK_STATS_COUNT} metrics to display in the Quick Stats panel
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "56vh", overflow: "auto" }}>
          <ul className="cfg-list">
            {METRIC_CATALOG.map((m) => {
              const checked = sel.includes(m.key);
              return (
                <li key={m.key}>
                  <label className={`cfg-row${checked ? " on" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(m.key)} />
                    <span>{m.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="modal-foot">
          {warn && <span style={{ color: "var(--amber)", marginRight: "auto", fontSize: 13 }}>{warn}</span>}
          <span style={{ color: "var(--text-dim)", marginRight: "auto", fontSize: 13 }}>
            {!warn && `${sel.length} / ${QUICK_STATS_COUNT} selected`}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Configuration</button>
        </div>
      </div>
    </div>
  );
}

/** Quick Stats panel — 4 configurable metric tiles with a gear to reconfigure. */
export default function QuickStats({ values }: { values: Record<string, number> }) {
  const [keys, setKeys] = useState<string[]>(() => getQuickStats());
  const [configuring, setConfiguring] = useState(false);

  return (
    <div className="panel col-12">
      <div className="panel-head">
        <div className="panel-title">Quick Stats</div>
        <button className="card-gear" title="Configure Quick Stats" onClick={() => setConfiguring(true)}>
          <IconSettings size={16} />
        </button>
      </div>
      <div className="quick-stats-grid">
        {keys.map((key, i) => {
          const def = metricDef(key);
          const has = values[key] != null;
          return (
            <div className="quick-tile" key={i} style={{ ["--accent" as string]: def.accent }}>
              <div className="quick-tile-label">{def.label}</div>
              <div className="quick-tile-val">{formatMetricValue(key, values[key])}</div>
              <div className="quick-tile-sub">{has ? def.subtitle : "Awaiting unit data"}</div>
            </div>
          );
        })}
      </div>
      {configuring && (
        <ConfigureModal
          initial={keys}
          onClose={() => setConfiguring(false)}
          onSave={(next) => {
            setQuickStats(next);
            setKeys(next);
            setConfiguring(false);
          }}
        />
      )}
    </div>
  );
}
