import { useEffect, useState } from "react";
import { updateBridge, type UpdateStatus } from "./update/bridge";

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Settings → General → Application Updates.
// electron-updater client (GitHub Releases feed), mirroring Project VIPER:
// user-driven check → download (progress) → install & restart. Local data is
// never touched by the update (installer preserves userData).
export default function UpdatePanel() {
  const isElectron = updateBridge.isElectron;
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    updateBridge.getVersion().then(setVersion).catch(() => {});
    const off = updateBridge.onStatus((data) => {
      setStatus(data);
      if (data.status !== "downloading") setBusy(false);
      if (data.status === "error") setError(data.message);
    });
    return off;
  }, []);

  const check = async () => {
    setError(null); setBusy(true); setStatus({ status: "checking" });
    const r = await updateBridge.check();
    if (!r.success) { setError(r.error || "Check failed."); setBusy(false); setStatus(null); }
  };
  const download = async () => {
    setError(null); setBusy(true);
    const r = await updateBridge.download();
    if (!r.success) { setError(r.error || "Download failed."); setBusy(false); }
  };
  const install = async () => {
    setError(null); setBusy(true);
    const r = await updateBridge.install();
    if (r && r.success === false) { setError(r.error || "Install failed."); setBusy(false); }
  };

  const s = status;

  return (
    <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
      <div className="panel-head">
        <h2 className="panel-title">Application Updates</h2>
        <span className="panel-meta">GitHub Releases · local install · data preserved</span>
      </div>

      <dl className="kv">
        <dt>Current version</dt>
        <dd className="mono">{version || "—"}</dd>
        <dt>Channel</dt>
        <dd>Stable · electron-updater</dd>
      </dl>

      {!isElectron ? (
        <div className="icac-hint" style={{ marginTop: 12 }}>
          Auto-update runs in the desktop app only. Launch the desktop shell
          (<span className="mono">start-desktop.bat</span>) to check for updates.
        </div>
      ) : (
        <>
          <div className="upd-status-row">
            {s?.status === "checking" && <span className="upd-text dim">Checking for updates…</span>}
            {s?.status === "up-to-date" && <span className="upd-text ok">✓ You are running the latest version{s.version ? ` (${s.version})` : ""}.</span>}
            {s?.status === "available" && <span className="upd-text ok">🎉 Version <strong>{s.version}</strong> is available.</span>}
            {s?.status === "downloading" && (
              <div style={{ width: "100%" }}>
                <div className="upd-text cyan">Downloading update…</div>
                <div className="upd-bar"><div className="upd-bar-fill" style={{ width: `${s.percent}%` }} /></div>
                <div className="upd-text dim" style={{ marginTop: 4 }}>{s.percent}% — {fmtBytes(s.transferred)} / {fmtBytes(s.total)}</div>
              </div>
            )}
            {s?.status === "downloaded" && <span className="upd-text ok">✓ Version <strong>{s.version}</strong> downloaded and ready to install.</span>}
          </div>

          {s?.status === "available" && (
            <div className="upd-warn">Your local ICAC database and settings are preserved across updates.</div>
          )}

          <div className="modal-foot" style={{ paddingRight: 0 }}>
            {error && <span style={{ color: "var(--red)", alignSelf: "center", marginRight: "auto" }}>{error}</span>}
            {s?.status !== "downloaded" && s?.status !== "available" && (
              <button className="btn btn-ghost" onClick={check} disabled={busy}>
                {busy && s?.status === "checking" ? "Checking…" : "Check for Updates"}
              </button>
            )}
            {s?.status === "available" && (
              <button className="btn btn-primary" onClick={download} disabled={busy}>Download Update</button>
            )}
            {s?.status === "downloaded" && (
              <button className="btn btn-primary" onClick={install} disabled={busy}>Install &amp; Restart</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
