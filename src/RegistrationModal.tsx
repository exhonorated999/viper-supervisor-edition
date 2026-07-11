import { useState } from "react";
import { register, getRegistration, type Registration } from "./data/registration";

/**
 * Registration form — collects name, agency, agency email, agency address and
 * registers with Intellect-LE to obtain an API key. Used as a first-run gate
 * and as the re-register control in Settings.
 */
export default function RegistrationModal({
  firstRun = false,
  onClose,
  onRegistered,
}: {
  firstRun?: boolean;
  onClose?: () => void;
  onRegistered: () => void;
}) {
  const existing = getRegistration();
  const [form, setForm] = useState<Registration>({
    name: existing.name,
    agency: existing.agency,
    email: existing.email,
    address: existing.address,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Registration, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const emailOk = /.+@.+\..+/.test(form.email.trim());
  const canSubmit = form.name.trim() && form.agency.trim() && emailOk && !busy;

  const submit = async () => {
    if (!canSubmit) {
      setError("Name, agency and a valid agency email are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        name: form.name.trim(),
        agency: form.agency.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
      });
      onRegistered();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={firstRun ? undefined : onClose}>
      <div className="modal" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="panel-title">{firstRun ? "Register V.I.P.E.R. Supervisor Edition" : "Update Registration"}</div>
            <div className="page-sub" style={{ marginTop: 4 }}>
              Registers this install with Intellect-LE and enables bug reporting.
            </div>
          </div>
          {!firstRun && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Full name</label>
            <input className="input" value={form.name} disabled={busy}
              onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sgt. Michael Reynolds" />
          </div>
          <div className="field">
            <label>Agency</label>
            <input className="input" value={form.agency} disabled={busy}
              onChange={(e) => set("agency", e.target.value)} placeholder="e.g. Metro PD — Major Crimes" />
          </div>
          <div className="field">
            <label>Agency email</label>
            <input className="input" type="email" value={form.email} disabled={busy}
              onChange={(e) => set("email", e.target.value)} placeholder="name@agency.gov" />
          </div>
          <div className="field">
            <label>Agency address</label>
            <input className="input" value={form.address} disabled={busy}
              onChange={(e) => set("address", e.target.value)} placeholder="123 Main St, City, ST" />
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
        <div className="modal-foot">
          {firstRun && onClose && (
            <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={onClose} disabled={busy}>
              Skip for now
            </button>
          )}
          {!firstRun && (
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          )}
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            {busy ? "Registering…" : "Register"}
          </button>
        </div>
      </div>
    </div>
  );
}
