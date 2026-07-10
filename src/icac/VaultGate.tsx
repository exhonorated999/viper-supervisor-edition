import { useState } from "react";
import { unlock } from "./crypto/vault";
import { logAudit } from "./audit";

// Shown in place of the dashboard when the ICAC database is encrypted and the
// vault is locked. Unlocking derives the AES key in memory for this session
// only — the passphrase is never stored.
export default function VaultGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass) return;
    setBusy(true);
    setError(null);
    const ok = await unlock(pass);
    setBusy(false);
    if (ok) {
      setPass("");
      void logAudit("vault.unlock");
      onUnlocked();
    } else {
      setError("Incorrect passphrase.");
      void logAudit("vault.unlock.fail");
    }
  };

  return (
    <div className="panel icac-vault-gate">
      <div className="icac-vault-lock">🔒</div>
      <div className="icac-empty-title">ICAC database is encrypted</div>
      <div className="icac-empty-sub">
        Enter the supervisor passphrase to unlock the intelligence database for this
        session. The passphrase is never stored; the key lives in memory only.
      </div>
      <form className="icac-vault-form" onSubmit={submit}>
        <input
          type="password"
          autoFocus
          value={pass}
          placeholder="Passphrase"
          onChange={(e) => setPass(e.target.value)}
          className="icac-vault-input"
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !pass}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      {error && <div className="icac-assign-err" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
