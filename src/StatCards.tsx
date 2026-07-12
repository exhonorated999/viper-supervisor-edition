import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { METRIC_CATALOG, metricDef, formatMetricValue } from "./data/metrics";
import { setCardMetric } from "./data/prefs";
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
            <div className="metric-value">{formatMetricValue(key, values[key])}</div>
            <div className="metric-sub">{has ? def.subtitle : "Awaiting unit data"}</div>
          </div>
        );
      })}
    </div>
  );
}
