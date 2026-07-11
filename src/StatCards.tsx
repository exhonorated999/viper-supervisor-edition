import { useEffect, useRef, useState } from "react";
import { METRIC_CATALOG, metricDef, formatMetricValue } from "./data/metrics";
import { setCardMetric } from "./data/prefs";
import { IconSettings } from "./icons";

// A dropdown menu listing every catalog metric; highlights the current one.
function MetricMenu({
  selected,
  onPick,
  onClose,
}: {
  selected: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="dropdown-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="metric-menu" onClick={(e) => e.stopPropagation()}>
        {METRIC_CATALOG.map((m) => (
          <button
            key={m.key}
            className={`unit-menu-item${m.key === selected ? " active" : ""}`}
            onClick={() => onPick(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The top row of configurable stat cards. Each card shows a metric from the
 * catalog; the gear opens a menu to swap which metric that slot displays.
 * Selections persist via data/prefs (localStorage).
 */
export default function StatCards({
  prefs,
  values,
}: {
  prefs: string[];
  values: Record<string, number>;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the open menu on Escape.
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenIdx(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx]);

  return (
    <div
      ref={rootRef}
      className="grid stat-cards"
      style={{ gridTemplateColumns: `repeat(${Math.max(prefs.length, 1)}, 1fr)` }}
    >
      {prefs.map((key, i) => {
        const def = metricDef(key);
        const has = values[key] != null;
        return (
          <div
            key={i}
            className="metric-card cfg"
            style={{ ["--accent" as string]: def.accent }}
          >
            <div className="metric-head">
              <span className="metric-name">{def.label}</span>
              <div className="card-gear-wrap">
                <button
                  className="card-gear"
                  title="Change metric"
                  onClick={() => setOpenIdx((o) => (o === i ? null : i))}
                >
                  <IconSettings size={15} />
                </button>
                {openIdx === i && (
                  <MetricMenu
                    selected={key}
                    onPick={(k) => { setCardMetric(i, k); setOpenIdx(null); }}
                    onClose={() => setOpenIdx(null)}
                  />
                )}
              </div>
            </div>
            <div className="metric-value">{formatMetricValue(key, values[key])}</div>
            <div className="metric-sub">{has ? def.subtitle : "Awaiting unit data"}</div>
          </div>
        );
      })}
    </div>
  );
}
