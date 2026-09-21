import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { METRIC_CATALOG, metricDef, formatMetricValue } from "./data/metrics";
import { setCardMetric } from "./data/prefs";
import { periodTag, periodLabel, type PeriodMetrics, type SecondaryPeriod } from "./data/periods";
import { IconSettings } from "./icons";

// A dropdown menu listing every catalog metric; highlights the current one.
// Rendered through a portal on <body> with fixed positioning so it can never
// be clipped by an ancestor card's `overflow: hidden` or lose the stacking
// fight with the cards below it.
function MetricMenu({
  anchor,
  selected,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  selected: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  // Position the menu under (or above, if it would overflow the viewport) the
  // gear button, aligned to its right edge. Measured after layout so we know
  // the menu's real height.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const menuW = menuRef.current?.offsetWidth ?? 200;
      const menuH = menuRef.current?.offsetHeight ?? 240;
      const gap = 6;
      let top = a.bottom + gap;
      // Flip above the button if it would spill past the viewport bottom.
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, a.top - gap - menuH);
      }
      let left = a.right - menuW; // right-align to the gear
      left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  return createPortal(
    <>
      <div className="dropdown-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        ref={menuRef}
        className="metric-menu"
        style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
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
    </>,
    document.body
  );
}

/**
 * The top row of configurable stat cards. Each card shows a metric from the
 * catalog as TWO figures — calendar month to date, and the supervisor's chosen
 * secondary period (quarter or year) — with the lifetime total as the caption.
 * The gear opens a menu to swap which metric that slot displays; selections
 * persist via data/prefs (localStorage).
 */
export default function StatCards({
  prefs,
  periods,
  secondary,
}: {
  prefs: string[];
  periods: PeriodMetrics;
  secondary: SecondaryPeriod;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // Anchor element for the open menu's portal positioning.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Close the open menu on Escape.
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenIdx(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx]);

  const close = () => { setOpenIdx(null); setAnchor(null); };

  return (
    <div
      className="grid stat-cards"
      style={{ gridTemplateColumns: `repeat(${Math.max(prefs.length, 1)}, 1fr)` }}
    >
      {prefs.map((key, i) => {
        const def = metricDef(key);
        // Always two figures, like the VIPER investigator dashboard:
        // month-to-date on the left, the supervisor's chosen range on the
        // right. A metric with no period dimension investigator-side (e.g.
        // "active missing persons" is a standing count, not an event) is
        // omitted from the period buckets — show an em dash, not a bogus 0.
        const monthVal = periods.buckets.month[key];
        const secVal = periods.buckets[secondary][key];

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
                  onClick={(e) => {
                    if (openIdx === i) { close(); return; }
                    setAnchor(e.currentTarget);
                    setOpenIdx(i);
                  }}
                >
                  <IconSettings size={15} />
                </button>
                {openIdx === i && anchor && (
                  <MetricMenu
                    anchor={anchor}
                    selected={key}
                    onPick={(k) => { setCardMetric(i, k); close(); }}
                    onClose={close}
                  />
                )}
              </div>
            </div>

            <div className="metric-dual">
              <div className="metric-slot" title={periodLabel("month", periods.labels)}>
                <div className="metric-value">{formatMetricValue(key, monthVal)}</div>
                <div className="metric-period">THIS MONTH</div>
              </div>
              <div className="metric-slot alt" title={periodLabel(secondary, periods.labels)}>
                <div className="metric-value">{formatMetricValue(key, secVal)}</div>
                <div className="metric-period">{periodTag(secondary, periods.labels)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
