import { useEffect, useState } from "react";
import {
  vaultState, enableVault, disableVault, changePassphrase, lock, onVaultChange, type VaultState,
} from "./crypto/vault";
import { persistCurrent } from "./service";
import { getIcacRole, setIcacRole, type IcacRole } from "./config";
import { logAudit } from "./audit";
import AuditDialog from "./AuditDialog";

// Settings → ICAC → Security. Owns encryption-at-rest (passphrase vault),
// the access role (RBAC), and access to the local audit log. All local.
export default function IcacSecurity({ hasLocation }: { hasLocation: boolean }) {
  const [state, setState] = useState<VaultState>(vaultState());
  const [role, setRole] = useState<IcacRole>(getIcacRole());
  const [showAudit, setShowAudit] = useState(false);

  // enable form
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  // change form
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  // disable form
  const [disP, setDisP] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => onVaultChange(() => setState(vaultState())), []);

  const clear = () => { setMsg(null); setErr(null); };

  const enable = async () => {
    clear();
    if (p1.length < 8) { setErr("Use a passphrase of at least 8 characters."); return; }
    if (p1 !== p2) { setErr("Passphrases do not match."); return; }
    setBusy(true);
    try {
      await enableVault(p1);
      await persistCurrent(); // re-write the DB encrypted
      void logAudit("vault.enable");
      setP1(""); setP2("");
      setMsg("Encryption enabled. The database is now stored encrypted.");
    } catch (e: any) {
      setErr(`Could not enable encryption: ${String(e?.message || e)}`);
    } finally { setBusy(false); }
  };

  const rekey = async () => {
    clear();
    if (newP.length < 8) { setErr("New passphrase must be at least 8 characters."); return; }
    setBusy(true);
    try {
      const ok = await changePassphrase(oldP, newP);
      if (!ok) { setErr("Current passphrase is incorrect."); return; }
      await persistCurrent(); // re-encrypt under the new key
      void logAudit("vault.rekey");
      setOldP(""); setNewP("");
      setMsg("Passphrase changed.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const disable = async () => {
    clear();
    setBusy(true);
    try {
      const ok = await disableVault(disP);
      if (!ok) { setErr("Passphrase is incorrect."); return; }
      await persistCurrent(); // re-write the DB plaintext
      void logAudit("vault.disable");
      setDisP("");
      setMsg("Encryption disabled. The database is now stored unencrypted.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const changeRole = (r: IcacRole) => {
    setRole(r);
    setIcacRole(r);
    void logAudit("role.change", `→ ${r}`);
  };

  return (
    <div className="icac-storage" style={{ marginTop: 18 }}>
      <div className="section-label">Security</div>

      {/* Encryption at rest */}
      <div className="icac-sec-block">
        <div className="icac-sec-head">
          <span className="icac-sec-title">Encryption at rest</span>
          <span className={`status-chip ${state === "unlocked" ? "s-ok" : state === "locked" ? "s-warn" : "s-read"}`}>
            {state === "off" ? "Off" : state === "locked" ? "Locked" : "On · unlocked"}
          </span>
        </div>

        {state === "off" && (
          <>
            <div className="icac-hint">
              Encrypt the ICAC database with a passphrase (AES-256-GCM, PBKDF2-SHA-256).
              The passphrase is never stored — you'll enter it once per session to unlock.
              Keep it safe: <b>if lost, the database cannot be recovered.</b>
            </div>
            {!hasLocation ? (
              <div className="icac-hint" style={{ color: "var(--amber)" }}>Choose a database location first.</div>
            ) : (
              <div className="icac-sec-form">
                <input type="password" className="icac-vault-input" placeholder="New passphrase (min 8)" value={p1} onChange={(e) => setP1(e.target.value)} />
                <input type="password" className="icac-vault-input" placeholder="Confirm passphrase" value={p2} onChange={(e) => setP2(e.target.value)} />
                <button className="btn btn-primary" onClick={enable} disabled={busy || !p1 || !p2}>Enable encryption</button>
              </div>
            )}
          </>
        )}

        {state !== "off" && (
          <>
            <div className="icac-hint">The database is encrypted on disk.</div>
            <div className="icac-sec-form">
              <input type="password" className="icac-vault-input" placeholder="Current passphrase" value={oldP} onChange={(e) => setOldP(e.target.value)} />
              <input type="password" className="icac-vault-input" placeholder="New passphrase (min 8)" value={newP} onChange={(e) => setNewP(e.target.value)} />
              <button className="btn btn-ghost" onClick={rekey} disabled={busy || !oldP || !newP}>Change passphrase</button>
            </div>
            <div className="icac-sec-form" style={{ marginTop: 8 }}>
              {state === "unlocked" && (
                <button className="btn btn-ghost" onClick={() => { lock(); void logAudit("vault.lock"); }}>🔒 Lock now</button>
              )}
              <input type="password" className="icac-vault-input" placeholder="Passphrase to disable" value={disP} onChange={(e) => setDisP(e.target.value)} />
              <button className="btn btn-danger" onClick={disable} disabled={busy || !disP}>Disable encryption</button>
            </div>
          </>
        )}
      </div>

      {/* Access role (RBAC) */}
      <div className="icac-sec-block">
        <div className="icac-sec-head">
          <span className="icac-sec-title">Access role</span>
        </div>
        <div className="icac-hint">
          <b>Command</b> allows import, assignment, and export. <b>Read-only</b> permits
          viewing the dashboard but disables all mutating actions on this machine.
        </div>
        <div className="icac-role-toggle">
          <button className={`icac-role-opt${role === "command" ? " sel" : ""}`} onClick={() => changeRole("command")}>Command (full)</button>
          <button className={`icac-role-opt${role === "readonly" ? " sel" : ""}`} onClick={() => changeRole("readonly")}>Read-only</button>
        </div>
      </div>

      {/* Audit log */}
      <div className="icac-sec-block">
        <div className="icac-sec-head">
          <span className="icac-sec-title">Audit log</span>
        </div>
        <div className="icac-hint">Local, append-only record of ICAC actions (unlock, import, assign, export). Never leaves this machine.</div>
        <button className="btn btn-ghost" onClick={() => setShowAudit(true)}>View audit log</button>
      </div>

      {msg && <div className="icac-import-ok">{msg}</div>}
      {err && <div className="icac-hint" style={{ color: "var(--red)" }}>{err}</div>}

      {showAudit && <AuditDialog onClose={() => setShowAudit(false)} />}
    </div>
  );
}
