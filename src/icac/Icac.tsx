import { useEffect, useState } from "react";
import { getIcacLocationLabel } from "./config";
import { getIcacStorage } from "./storage/index";
import type { IcacIndex } from "./types";

// ICAC dashboard shell (Phase 1). The full three-tier dashboard (metric tiles,
// timeline, heatmap, provider intelligence, linker, assignment, export) lands in
// Phase 3. For now this confirms the module is active, shows the storage
// location, and renders an empty/summary state driven by the local index.
export default function Icac() {
  const [location, setLocation] = useState<string | null>(getIcacLocationLabel());
  const [index, setIndex] = useState<IcacIndex | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const storage = getIcacStorage();
    setLocation(getIcacLocationLabel());
    storage
      .readIndex()
      .then((ix) => { if (alive) setIndex(ix); })
      .catch(() => { if (alive) setIndex(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const tipCount = index?.tips.length ?? 0;

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">ICAC Supervisor Dashboard</h1>
          <div className="page-sub">Internet Crimes Against Children — Intelligence Center</div>
        </div>
        <div className="icac-loc-chip">
          {location ? (
            <><span className="dot" style={{ background: "var(--green)", boxShadow: "0 0 8px var(--green)" }} /> {location}</>
          ) : (
            <><span className="dot" style={{ background: "var(--amber)" }} /> No storage location</>
          )}
        </div>
      </div>

      {!location ? (
        <div className="panel icac-empty">
          <IconShield />
          <div className="icac-empty-title">Choose where to store the ICAC database</div>
          <div className="icac-empty-sub">
            Open <b>Settings → Optional Modules → ICAC Processing</b> and pick a folder or USB drive.
            All CyberTip intelligence stays on this machine and never crosses the network.
          </div>
        </div>
      ) : loading ? (
        <div className="panel icac-empty"><div className="icac-empty-sub">Loading intelligence database…</div></div>
      ) : tipCount === 0 ? (
        <div className="panel icac-empty">
          <IconShield />
          <div className="icac-empty-title">No CyberTips imported yet</div>
          <div className="icac-empty-sub">
            Bulk import (drag-and-drop ZIPs or PDFs), the intelligence dashboard, repeat-suspect
            linking, and the assignment queue arrive in the next build phase.
          </div>
        </div>
      ) : (
        <div className="panel icac-empty">
          <div className="icac-empty-title">{tipCount} CyberTip{tipCount === 1 ? "" : "s"} in database</div>
          <div className="icac-empty-sub">The full dashboard renders these in Phase 3.</div>
        </div>
      )}
    </>
  );
}

function IconShield() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9.5 11.5a2.5 2.5 0 0 1 5 0v1M9.5 13.8c0 1.2.3 2 .8 2.7M14.5 12.6c0 1.6-.3 2.9-1 3.9" />
    </svg>
  );
}
