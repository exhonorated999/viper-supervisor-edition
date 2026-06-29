import { useEffect, useState } from "react";
import { dataService } from "./data/service";
import type { Delivery, DeliveryType } from "./data/service";

const TYPE_META: Record<DeliveryType, { label: string; cls: string }> = {
  stats: { label: "Stats Snapshot", cls: "t-stats" },
  caseStatus: { label: "Case-Status Digest", cls: "t-cases" },
  opsPlan: { label: "OPS Plan — Approval", cls: "t-ops" },
};

const STATUS_META: Record<Delivery["status"], { label: string; cls: string }> = {
  unread: { label: "New", cls: "s-new" },
  read: { label: "Reviewed", cls: "s-read" },
  approved: { label: "Approved", cls: "s-ok" },
  returned: { label: "Returned", cls: "s-warn" },
};

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export default function Inbox() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [open, setOpen] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setItems(await dataService.getDeliveries());
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Live: a new delivery arrives, or a decision changes status → refresh.
    const off = dataService.lan.onEvent((e) => {
      if (e.kind === "delivery:new") load();
    });
    return off;
  }, []);

  const openDelivery = async (d: Delivery) => {
    setOpen(d);
    if (d.status === "unread") {
      await dataService.ackDelivery(d.id);
      setItems((prev) =>
        prev.map((x) => (x.id === d.id ? { ...x, status: "read" } : x))
      );
    }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Inbox</h1>
          <div className="page-sub">
            Incoming datasets &amp; OPS plans pushed from investigator devices.
          </div>
        </div>
        <button className="btn btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="panel">
        {loading ? (
          <div className="inbox-empty">Loading inbox…</div>
        ) : items.length === 0 ? (
          <div className="inbox-empty">
            <div className="inbox-empty-mark">⇩</div>
            No deliveries yet. When an investigator pushes a dataset or OPS plan
            to this machine, it appears here.
          </div>
        ) : (
          <ul className="inbox-list">
            {items.map((d) => {
              const tm = TYPE_META[d.dtype];
              const sm = STATUS_META[d.status];
              return (
                <li
                  key={d.id}
                  className={`inbox-row${d.status === "unread" ? " unread" : ""}`}
                  onClick={() => openDelivery(d)}
                >
                  <span className={`type-chip ${tm.cls}`}>{tm.label}</span>
                  <div className="inbox-main">
                    <div className="inbox-title">
                      {d.manifest?.title || tm.label}
                    </div>
                    <div className="inbox-sub">
                      from <strong>{d.from}</strong> {d.fromBadge} · {fmt(d.sentAt)}
                    </div>
                  </div>
                  <span className={`status-chip ${sm.cls}`}>{sm.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && (
        <DeliveryModal
          delivery={open}
          onClose={() => setOpen(null)}
          onDecided={(decision) => {
            setItems((prev) =>
              prev.map((x) => (x.id === open.id ? { ...x, status: decision } : x))
            );
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function openPdf(body: any) {
  try {
    const b64: string = body?.pdfBase64 || "";
    const clean = b64.includes(",") ? b64.split(",")[1] : b64;
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    alert("Unable to open PDF — payload may be malformed.");
  }
}

function DeliveryModal({
  delivery,
  onClose,
  onDecided,
}: {
  delivery: Delivery;
  onClose: () => void;
  onDecided: (decision: "approved" | "returned") => void;
}) {
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const m = delivery.manifest || {};
  const body = delivery.body || {};

  const decide = async (decision: "approved" | "returned") => {
    if (decision === "returned" && !comments.trim()) {
      alert("Returned plans require supervisor comments.");
      return;
    }
    setBusy(true);
    await dataService.decideDelivery(delivery.id, decision, comments.trim());
    setBusy(false);
    onDecided(decision);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="ops-id">{TYPE_META[delivery.dtype].label} · {delivery.id}</div>
            <h2 className="panel-title" style={{ marginTop: 4 }}>
              {m.title || TYPE_META[delivery.dtype].label}
            </h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <dl className="kv">
            <dt>From</dt>
            <dd>{delivery.from} {delivery.fromBadge}</dd>
            <dt>Received</dt>
            <dd>{fmt(delivery.sentAt)}</dd>
          </dl>

          {delivery.dtype === "stats" && <StatsView body={body} />}
          {delivery.dtype === "caseStatus" && <DigestView body={body} />}
          {delivery.dtype === "opsPlan" && (
            <OpsView manifest={m} body={body} decision={delivery.decision} />
          )}
        </div>

        <div className="modal-foot">
          {delivery.dtype === "opsPlan" &&
          delivery.status !== "approved" &&
          delivery.status !== "returned" ? (
            <>
              <input
                className="input"
                style={{ flex: 1, marginRight: "auto" }}
                placeholder="Comments (required to return)…"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
              <button className="btn btn-ghost" disabled={busy} onClick={() => decide("returned")}>
                Return
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => decide("approved")}>
                {busy ? "Sending…" : "Approve & Sign"}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsView({ body }: { body: any }) {
  const headline: { label: string; value: string | number }[] = body?.headline || [];
  const byType: { label: string; count: number }[] = body?.byType || [];
  const byStatus: { label: string; count: number }[] = body?.byStatus || [];
  return (
    <>
      <div className="section-label" style={{ margin: "0 0 8px" }}>Productivity Snapshot</div>
      <div className="snap-grid">
        {headline.map((h) => (
          <div className="snap-card" key={h.label}>
            <div className="snap-value">{h.value}</div>
            <div className="snap-label">{h.label}</div>
          </div>
        ))}
      </div>
      {byStatus.length > 0 && (
        <MiniBars title="By Status" rows={byStatus} />
      )}
      {byType.length > 0 && (
        <MiniBars title="By Case Type" rows={byType} />
      )}
    </>
  );
}

function MiniBars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>{title}</div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="bar-count">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function DigestView({ body }: { body: any }) {
  const rows: any[] = body?.rows || [];
  return (
    <>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        Case-Status Digest · {rows.length} case{rows.length === 1 ? "" : "s"}{" "}
        <span style={{ color: "var(--text-faint)" }}>(metadata only — no case content)</span>
      </div>
      <div className="digest-wrap">
        <table className="digest-table">
          <thead>
            <tr>
              <th>Case</th><th>Label</th><th>State</th><th>Risk</th><th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.caseNumber || i}>
                <td className="mono">{r.caseNumber || "—"}</td>
                <td>{r.label || "—"}</td>
                <td>{r.state || "—"}</td>
                <td>{r.risk || "—"}</td>
                <td>{r.lastActivity || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OpsView({ manifest, body, decision }: { manifest: any; body: any; decision?: any }) {
  return (
    <>
      <dl className="kv">
        {manifest.caseNumber && (<><dt>Case</dt><dd className="mono">{manifest.caseNumber}</dd></>)}
        {manifest.risk && (<><dt>Risk</dt><dd>{manifest.risk}</dd></>)}
        {manifest.date && (<><dt>Operation date</dt><dd>{manifest.date}</dd></>)}
        {manifest.location && (<><dt>Location</dt><dd>{manifest.location}</dd></>)}
      </dl>
      <div className="pdf-tile">
        <div className="pdf-icon">PDF</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff" }}>{body?.fileName || "operations-plan.pdf"}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Operations plan for digital approval
          </div>
        </div>
        <button className="btn btn-ghost" disabled={!body?.pdfBase64} onClick={() => openPdf(body)}>
          Open PDF
        </button>
      </div>
      {decision && (
        <div className="signed-banner" style={{ marginTop: 14 }}>
          <span>{decision.decision === "approved" ? "✓" : "↩"}</span>
          <div>
            {decision.decision === "approved" ? "Approved" : "Returned"} by {decision.by}
            {decision.comments ? ` · "${decision.comments}"` : ""}
          </div>
        </div>
      )}
    </>
  );
}
