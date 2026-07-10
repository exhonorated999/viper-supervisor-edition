import { useCallback, useEffect, useRef, useState } from "react";
import { getIdsConfig, onIdsConfigChange, hasIdsCreds, type IdsConfig } from "./config";
import { buildAutofillScript } from "./autofill";
import { idsBridge } from "./bridge";
import {
  initStaging, onStagingChange, getStaged, addManualFiles,
  filesFor, setStatus, remove, clearIngested, type StagedItem,
} from "./staging";
import { ingestFiles, type IngestProgress } from "../import/ingest";
import { addTips } from "../service";
import { logAudit } from "../audit";

function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function IdsTray({
  onClose, onIngested, readonly,
}: { onClose: () => void; onIngested?: () => void; readonly?: boolean }) {
  const [cfg, setCfg] = useState<IdsConfig>(getIdsConfig());
  const [items, setItems] = useState<StagedItem[]>(getStaged());
  const [navUrl, setNavUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [autofillMsg, setAutofillMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<IngestProgress[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webviewRef = useRef<any>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const isElectron = idsBridge.isElectron;
  const staged = items.filter((i) => i.status === "staged");

  // config + staging subscriptions
  useEffect(() => {
    void initStaging();
    const offCfg = onIdsConfigChange(() => setCfg(getIdsConfig()));
    const offStg = onStagingChange(() => setItems(getStaged()));
    setItems(getStaged());
    return () => { offCfg(); offStg(); };
  }, []);

  // audit each captured download while the tray is open
  useEffect(() => {
    if (!isElectron) return;
    return idsBridge.onStaged((m) => { void logAudit("ids.download", `${m.name} · ${fmtBytes(m.size)}`); });
  }, [isElectron]);

  const runAutofill = useCallback(async () => {
    const wv = webviewRef.current;
    if (!wv || !hasIdsCreds(cfg)) { setAutofillMsg(hasIdsCreds(cfg) ? null : "Set credentials in Settings"); return; }
    try {
      const res = await wv.executeJavaScript(buildAutofillScript(cfg), true);
      const map: Record<string, string> = {
        filled: "✓ Credentials filled", submitted: "✓ Filled & submitted",
        partial: "Partially filled — check the form", "no-fields": "No login fields found on this page",
      };
      setAutofillMsg(map[res] || (typeof res === "string" && res.startsWith("error") ? "Autofill error" : "Done"));
    } catch {
      setAutofillMsg("Autofill unavailable on this page");
    }
    setTimeout(() => setAutofillMsg(null), 3500);
  }, [cfg]);

  // wire webview navigation + optional auto-autofill
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !isElectron) return;
    try { wv.setAttribute("allowpopups", "true"); } catch { /* ignore */ }
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onNav = (e: any) => { if (e?.url) setNavUrl(e.url); };
    const onReady = () => { if (cfg.autofill && hasIdsCreds(cfg)) setTimeout(() => void runAutofill(), 600); };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onNav);
    wv.addEventListener("did-navigate-in-page", onNav);
    wv.addEventListener("dom-ready", onReady);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onNav);
      wv.removeEventListener("did-navigate-in-page", onNav);
      wv.removeEventListener("dom-ready", onReady);
    };
  }, [isElectron, cfg, runAutofill]);

  const nav = (fn: "goBack" | "goForward" | "reload") => { try { webviewRef.current?.[fn](); } catch { /* ignore */ } };
  const goHome = () => { try { if (cfg.url) webviewRef.current?.loadURL(cfg.url); } catch { /* ignore */ } };

  const onManual = (files: File[]) => {
    const zips = files.filter((f) => /\.(zip|pdf)$/i.test(f.name));
    if (zips.length) addManualFiles(zips);
  };

  const runIngest = useCallback(async () => {
    if (readonly) return;
    const targets = getStaged().filter((i) => i.status === "staged");
    if (!targets.length) return;
    setBusy(true); setError(null); setSummary(null); setRows([]);
    try {
      const pairs = await filesFor(targets.map((t) => t.id));
      if (!pairs.length) { setError("None of the staged files could be read."); return; }
      const { tips } = await ingestFiles(pairs.map((p) => p.file), (p) => {
        setRows((prev) => {
          const i = prev.findIndex((r) => r.fileName === p.fileName);
          if (i >= 0) { const next = prev.slice(); next[i] = p; return next; }
          return [...prev, p];
        });
      });
      if (!tips.length) { setError("No CyberTips could be parsed from the staged files."); return; }
      const { added, updated } = await addTips(tips);
      for (const p of pairs) setStatus(p.id, "ingested");
      void logAudit("ids.ingest", `${pairs.length} file(s) · ${added} added, ${updated} updated`);
      setSummary(`${added} added, ${updated} updated · ${tips.length} report(s) from ${pairs.length} file(s)`);
      onIngested?.();
    } catch (e: any) {
      setError(String(e?.message || e) + " — set a storage location in Settings → Optional Modules.");
    } finally {
      setBusy(false);
    }
  }, [readonly, onIngested]);

  const noUrl = !cfg.url;

  return (
    <div className="ids-tray-overlay" onClick={onClose}>
      <aside className="ids-tray" onClick={(e) => e.stopPropagation()}>
        <header className="ids-tray-head">
          <div>
            <div className="ids-tray-title">ICAC Data System</div>
            <div className="ids-tray-sub">
              {isElectron ? "Embedded secure browser · downloads captured to staging" : "Web build · external browser"}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {/* Browser region */}
        <div className="ids-browser">
          {isElectron ? (
            <>
              <div className="ids-navbar">
                <button className="ids-nav-btn" onClick={() => nav("goBack")} title="Back">←</button>
                <button className="ids-nav-btn" onClick={() => nav("goForward")} title="Forward">→</button>
                <button className="ids-nav-btn" onClick={() => nav("reload")} title="Reload">⟳</button>
                <button className="ids-nav-btn" onClick={goHome} title="Home (IDS URL)">⌂</button>
                <div className={`ids-url${loading ? " loading" : ""}`} title={navUrl || cfg.url}>
                  {loading ? "Loading…" : (navUrl || cfg.url || "No IDS URL set")}
                </div>
                <button className="btn btn-primary btn-sm" onClick={runAutofill} disabled={!hasIdsCreds(cfg)}>
                  Autofill login
                </button>
              </div>
              {autofillMsg && <div className="ids-autofill-msg">{autofillMsg}</div>}
              {noUrl ? (
                <div className="ids-browser-empty">
                  Set the IDS portal URL in <b>Settings → Optional Modules → ICAC Data System</b> to load it here.
                </div>
              ) : (
                <webview
                  ref={webviewRef}
                  src={cfg.url}
                  partition="persist:ids"
                  className="ids-webview"
                />
              )}
            </>
          ) : (
            <div className="ids-browser-empty ids-web-fallback">
              <div className="ids-web-fallback-title">Embedded browser needs the desktop app</div>
              <div className="ids-web-fallback-sub">
                Run the Supervisor Edition desktop shell (<span className="mono">npm run desktop</span>) to browse IDS
                and capture downloads in-app. In this web build, open IDS in your browser, download the CyberTip ZIPs,
                then drop them into the staging area below.
              </div>
              <button className="btn btn-primary" disabled={noUrl} onClick={() => idsBridge.openExternal(cfg.url)}>
                Open IDS in browser
              </button>
            </div>
          )}
        </div>

        {/* Staging region */}
        <div
          className={`ids-staging${drag ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onManual(Array.from(e.dataTransfer.files)); }}
        >
          <div className="ids-staging-head">
            <div className="ids-staging-title">
              Staging <span className="ids-count">{staged.length}</span>
              {items.length > staged.length && <span className="ids-count done">{items.length - staged.length} done</span>}
            </div>
            <div className="ids-staging-actions">
              <input
                ref={pickRef} type="file" multiple accept=".zip,.pdf" style={{ display: "none" }}
                onChange={(e) => { onManual(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }}
              />
              <button className="btn btn-ghost btn-sm" onClick={() => pickRef.current?.click()}>Add ZIPs</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void clearIngested()} disabled={items.length === staged.length}>
                Clear done
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={runIngest}
                disabled={busy || readonly || !staged.length}
                title={readonly ? "Read-only access" : ""}
              >
                {busy ? "Parsing…" : `Batch Ingest & Parse (${staged.length})`}
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="ids-staging-empty">
              {isElectron
                ? "Download CyberTip ZIPs from IDS above — they'll appear here for batch parsing."
                : "Drop CyberTip ZIPs/PDFs here, or use Add ZIPs, then batch-parse them into the store."}
            </div>
          ) : (
            <div className="ids-staging-list">
              {items.map((it) => (
                <div className="ids-staged-row" key={it.id}>
                  <span className={`ids-dot s-${it.status}`} />
                  <span className="ids-staged-name" title={it.name}>{it.name}</span>
                  <span className="ids-staged-meta">
                    {it.source === "ids" ? "IDS" : "manual"} · {fmtBytes(it.size)}
                    {it.detail ? ` · ${it.detail}` : ""}
                  </span>
                  <button className="ids-staged-x" onClick={() => void remove(it.id)} title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="ids-ingest-list">
              {rows.map((r, i) => (
                <div className="icac-import-row" key={r.fileName + i}>
                  <span className={`ic-status ic-${r.status}`} />
                  <span className="ic-name" title={r.fileName}>{r.fileName}</span>
                  <span className="ic-detail">
                    {r.provider ? `${r.provider} · ` : ""}
                    {typeof r.contraband === "number" ? `${r.contraband} media · ` : ""}
                    {r.detail || r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
          {summary && <div className="icac-import-ok">✓ {summary}</div>}
          {error && <div className="icac-import-err">{error}</div>}
        </div>
      </aside>
    </div>
  );
}
