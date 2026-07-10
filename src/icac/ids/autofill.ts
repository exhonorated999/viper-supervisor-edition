// Builds the credential-autofill script injected into the IDS <webview>.
//
// Runs inside the IDS page context (via webview.executeJavaScript). Finds the
// username + password fields — using operator-provided CSS selectors when set,
// otherwise heuristic auto-detection — sets their values, and fires the input
// events SPA login forms need. It never auto-submits unless a submit selector
// is configured. Credentials are embedded as JSON literals (safely escaped).
// ---------------------------------------------------------------------------

import type { IdsConfig } from "./config";

export function buildAutofillScript(cfg: IdsConfig): string {
  const payload = JSON.stringify({
    user: cfg.username,
    pass: cfg.password,
    userSel: cfg.userSel,
    passSel: cfg.passSel,
    submitSel: cfg.submitSel,
  });

  // The IIFE returns a small status string so the tray can report success.
  return `(function(){
    try {
      var C = ${payload};
      function vis(el){ return el && el.offsetParent !== null && !el.disabled && !el.readOnly; }
      function pick(sel, fallbackList){
        if (sel){ var el = document.querySelector(sel); if (el) return el; }
        for (var i=0;i<fallbackList.length;i++){
          var nodes = document.querySelectorAll(fallbackList[i]);
          for (var j=0;j<nodes.length;j++){ if (vis(nodes[j])) return nodes[j]; }
        }
        return null;
      }
      function setVal(el, val){
        if (!el) return false;
        var proto = Object.getPrototypeOf(el);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, val); else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      var u = pick(C.userSel, ['input[type=email]','input[autocomplete=username]','input[name*=user i]','input[id*=user i]','input[name*=email i]','input[type=text]']);
      var p = pick(C.passSel, ['input[type=password]']);
      var okU = C.user ? setVal(u, C.user) : false;
      var okP = C.pass ? setVal(p, C.pass) : false;
      if (!okU && !okP) return 'no-fields';
      if (p) p.focus();
      if (C.submitSel){
        var b = document.querySelector(C.submitSel);
        if (b) { b.click(); return 'submitted'; }
      }
      return (okU && okP) ? 'filled' : 'partial';
    } catch (e) { return 'error:' + (e && e.message ? e.message : e); }
  })();`;
}
