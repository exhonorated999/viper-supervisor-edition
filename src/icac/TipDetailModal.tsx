// Read-only detail view for a single parsed CyberTip. Opened from the
// Assignment Queue and High-Priority CyberTips lists. Shows the extracted,
// metadata-level record only — no file bytes, and nothing here crosses the LAN.
import { useEffect } from "react";
import type { CyberTip } from "./types";
import { getWarrants, loadWarrantPdf } from "./service";

const CAT_LABEL: Record<string, string> = {
  A1: "CSAM — prepubescent",
  A2: "CSAM — pubescent minor",
  B1: "Child nudity / other",
  B2: "Age-difficult / other",
};

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="tipd-row">
      <span className="tipd-k">{label}</span>
      <span className="tipd-v">{value}</span>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="tipd-chips">
      {items.map((v, i) => (
        <span className="tipd-chip mono" key={i}>{v}</span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tipd-section">
      <div className="tipd-section-head">{title}</div>
      <div className="tipd-section-body">{children}</div>
    </div>
  );
}

export default function TipDetailModal({ tip, onClose }: { tip: CyberTip; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const id = tip.identifiers;
  const dev = id.device_ids;
  const allDeviceIds = [...dev.imei, ...dev.mac, ...dev.gaid, ...dev.idfa, ...dev.other];
  const cats = tip.contraband.categories;
  const warrant = tip.warrant_id ? getWarrants().find((w) => w.id === tip.warrant_id) : undefined;
  const viewWarrantPdf = async () => {
    if (!warrant) return;
    const blob = await loadWarrantPdf(warrant.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const hasIds =
    id.emails.length || id.usernames.length || id.phone_numbers.length ||
    id.ip_addresses.length || id.esp_user_ids.length || allDeviceIds.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal icac-tip-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="panel-title">CyberTip {tip.cybertip_number || "(no #)"}</h2>
            <div className="tipd-subhead">{tip.provider} · {tip.source_doc_type.toUpperCase()} · parse confidence {tip.parse_confidence}</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body tipd-body">
          {tip.disposition?.state === "closed" && (
            <Section title="Disposition">
              <Field label="Status" value={<span className="status-chip s-closed">Closed</span>} />
              <Field label="Reason" value={tip.disposition.reason} />
              <Field label="Note" value={tip.disposition.note || undefined} />
              <Field label="Closed by" value={tip.disposition.closedBy} />
              <Field label="Closed at" value={tip.disposition.closedAt ? new Date(tip.disposition.closedAt).toLocaleString() : undefined} />
            </Section>
          )}

          <Section title="Overview">
            <Field label="CyberTip #" value={<span className="mono">{tip.cybertip_number || "—"}</span>} />
            <Field label="Provider" value={tip.provider} />
            <Field label="Priority" value={tip.priority_level} />
            <Field label="Incident type" value={tip.incident_type} />
            <Field label="Incident time" value={tip.incident_time} />
            <Field label="Date received" value={tip.date_received} />
            <Field label="Source file" value={<span className="mono">{tip.source_file}</span>} />
            <Field label="Imported" value={tip.imported_at ? new Date(tip.imported_at).toLocaleString() : undefined} />
          </Section>

          <Section title="Assignment">
            <Field label="Assigned to" value={tip.assignment.assigned_to || "Unassigned"} />
            <Field label="Priority" value={tip.assignment.priority || "—"} />
            <Field label="Status" value={tip.assignment.status || "unassigned"} />
            <Field label="Note" value={tip.assignment.note || undefined} />
          </Section>

          {warrant && (
            <Section title="Wilson Warrant">
              <Field label="Warrant #" value={<span className="mono">{warrant.warrant_number}</span>} />
              <Field label="Court" value={warrant.court} />
              <Field label="Judge" value={warrant.judge} />
              <Field label="Signed" value={warrant.signed_at} />
              <Field label="Covers" value={`${warrant.covered_tip_ids.length} CyberTip(s)`} />
              {warrant.signed_pdf_key && (
                <Field label="Signed PDF" value={
                  <button className="tipd-link" onClick={viewWarrantPdf}>{warrant.signed_pdf_name || "View PDF"}</button>
                } />
              )}
              {warrant.note && <Field label="Note" value={warrant.note} />}
            </Section>
          )}

          <Section title="Contraband (metadata only)">
            <Field label="Media files" value={tip.contraband.file_count} />
            <Field label="Hashes (MD5)" value={tip.contraband.md5.length || undefined} />
            {tip.contraband.total_bytes != null && (
              <Field label="Total bytes" value={tip.contraband.total_bytes.toLocaleString()} />
            )}
            {cats.length > 0 && (
              <Field
                label="Categories"
                value={
                  <div className="tipd-chips">
                    {cats.map((c, i) => (
                      <span className="tipd-chip" key={i} title={CAT_LABEL[c] || c}>
                        {c}{CAT_LABEL[c] ? ` · ${CAT_LABEL[c]}` : ""}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
            {tip.contraband.file_names.length > 0 && (
              <Field label="File names" value={<Chips items={tip.contraband.file_names} />} />
            )}
          </Section>

          <Section title="Identifiers">
            {hasIds ? (
              <>
                {id.emails.length > 0 && <Field label="Emails" value={<Chips items={id.emails} />} />}
                {id.usernames.length > 0 && <Field label="Usernames" value={<Chips items={id.usernames} />} />}
                {id.phone_numbers.length > 0 && <Field label="Phones" value={<Chips items={id.phone_numbers} />} />}
                {id.ip_addresses.length > 0 && <Field label="IP addresses" value={<Chips items={id.ip_addresses} />} />}
                {id.esp_user_ids.length > 0 && <Field label="ESP user IDs" value={<Chips items={id.esp_user_ids} />} />}
                {allDeviceIds.length > 0 && <Field label="Device IDs" value={<Chips items={allDeviceIds} />} />}
              </>
            ) : (
              <div className="ic-dim">No identifiers extracted.</div>
            )}
          </Section>

          {tip.parties.length > 0 && (
            <Section title={`Parties (${tip.parties.length})`}>
              {tip.parties.map((p, i) => (
                <div className="tipd-party" key={i}>
                  <div className="tipd-party-head">
                    <span className={`sev-chip ${p.role === "suspect" ? "sev-high" : "sev-low"}`}>{p.role}</span>
                    <span className="tipd-party-name">{p.name || "(unnamed)"}</span>
                  </div>
                  <Field label="DOB" value={p.date_of_birth} />
                  <Field label="Approx. age" value={p.approximate_age} />
                  <Field label="Location" value={p.estimated_location} />
                  {p.emails.length > 0 && <Field label="Emails" value={<Chips items={p.emails} />} />}
                  {p.usernames.length > 0 && <Field label="Usernames" value={<Chips items={p.usernames} />} />}
                  {p.phones.length > 0 && <Field label="Phones" value={<Chips items={p.phones} />} />}
                  {p.ips.length > 0 && (
                    <Field label="IPs" value={<Chips items={p.ips.map((o) => o.ip + (o.kind ? ` (${o.kind})` : ""))} />} />
                  )}
                </div>
              ))}
            </Section>
          )}

          {(tip.prior_reports.length > 0 || tip.linked_tips.length > 0) && (
            <Section title="Links">
              {tip.prior_reports.length > 0 && <Field label="Prior CT reports" value={<Chips items={tip.prior_reports} />} />}
              {tip.linked_tips.length > 0 && <Field label="Linked tips" value={<Chips items={tip.linked_tips} />} />}
            </Section>
          )}

          {tip.missing_fields.length > 0 && (
            <Section title="Parser notes">
              <Field label="Missing fields" value={<Chips items={tip.missing_fields} />} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
