// ---------------------------------------------------------------------------
// Interactive HTML export.
//
// Produces ONE self-contained .html file: inline CSS, inline JS, inline SVG
// charts, embedded JSON dataset. No CDN, no fonts, no fetch — it opens from a
// USB stick over file:// years from now with no network and still works.
//
// Why bother when we already emit PDF: a PDF is a photograph of the numbers.
// This is the numbers. A supervisor can sort the case table, filter to one
// detective, toggle a series off the chart — and still hand the identical file
// to a chief who only wants to hit Print.
//
// SECURITY: every interpolated value goes through esc(). The embedded dataset
// goes through jsonForScript(), which additionally escapes "<" so a hostile
// case number containing "</script>" cannot break out of the script block.
// ---------------------------------------------------------------------------

import type { OpsPlan } from "../types";
import { reportFilename, type ReportPayload } from "./payload";

const C = {
  bg: "#0e1117",
  panel: "#1a1f27",
  panel2: "#20262f",
  panel3: "#161a21",
  cyan: "#00b7c3",
  green: "#4caf50",
  amber: "#ffc107",
  red: "#ef5350",
  purple: "#a06cd5",
  text: "#e0e0e0",
  dim: "#a0a0a0",
  faint: "#6b7280",
  border: "#262d38",
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON safe to inline inside a <script> block. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const SECTION_TITLES: Record<string, string> = {
  metrics: "Key Metrics",
  activity: "Activity",
  trend: "Trend",
  breakdown: "Case Status",
  workload: "Investigator Workload",
  cases: "Cases",
  ops: "OPS Plans",
};

/** OPS plans carry a base64 PDF — strip it or the export balloons to megabytes. */
function slimOps(list: OpsPlan[]) {
  return list.map((o) => ({
    id: o.id,
    title: o.title,
    detective: o.detective,
    submittedDate: o.submittedDate,
    risk: o.risk,
    status: o.status,
    signedBy: o.signedBy || "",
    signedAt: o.signedAt || "",
  }));
}

function emptyState(msg: string): string {
  return `<div class="empty">${esc(msg)}</div>`;
}

function metricsSection(p: ReportPayload): string {
  if (!p.metrics.length) return emptyState("No metrics selected.");
  const cards = p.metrics
    .map(
      (m) => `
      <div class="mcard">
        <div class="mlabel">${esc(m.label)}</div>
        <div class="mrow">
          <div class="mslot">
            <div class="mval${m.value == null ? " na" : ""}">${esc(m.value ?? "—")}</div>
            <div class="mtag">${esc(p.scope.label)}</div>
          </div>
          <div class="mslot">
            <div class="mval alt">${esc(m.allTime)}</div>
            <div class="mtag">All time</div>
          </div>
        </div>
        ${m.note ? `<div class="mnote">${esc(m.note)}</div>` : ""}
      </div>`
    )
    .join("");
  return `<div class="mgrid">${cards}</div>`;
}

function activitySection(p: ReportPayload): string {
  const any = p.activity.some((a) => a.value > 0);
  if (!any) return emptyState("No activity events in this window.");
  return `<div id="activityChart" class="chartbox"></div>`;
}

function trendSection(p: ReportPayload): string {
  if (!p.series.length) return emptyState("Not enough dated activity to plot a trend.");
  return `
    <div class="legend" id="trendLegend"></div>
    <div id="trendChart" class="chartbox"></div>`;
}

function breakdownSection(p: ReportPayload): string {
  if (!p.breakdown.length) return emptyState("No case-status data received yet.");
  return `<div class="donutwrap"><div id="donut"></div><div class="legend col" id="donutLegend"></div></div>`;
}

function workloadSection(p: ReportPayload): string {
  if (!p.workload.length) return emptyState("No investigators reporting yet.");
  return `
    <div class="chips" id="bandChips"></div>
    <table class="tbl" id="workloadTable">
      <thead><tr>
        <th data-k="name">Investigator</th>
        <th data-k="total" class="num">Total</th>
        <th data-k="open" class="num">Open</th>
        <th data-k="ongoing" class="num">Ongoing</th>
        <th data-k="aging" class="num">Aging</th>
        <th data-k="newMtd" class="num">New</th>
        <th data-k="band">Band</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
}

function casesSection(p: ReportPayload): string {
  if (!p.cases.length) return emptyState("No cases match this scope.");
  return `
    <div class="toolbar">
      <input id="caseSearch" type="search" placeholder="Filter cases…" autocomplete="off" />
      <span class="count" id="caseCount"></span>
    </div>
    <div class="chips" id="stateChips"></div>
    <table class="tbl" id="caseTable">
      <thead><tr>
        <th data-k="caseNumber">Case</th>
        <th data-k="detective">Detective</th>
        <th data-k="state">State</th>
        <th data-k="caseType">Type</th>
        <th data-k="ageDays" class="num">Age</th>
        <th data-k="lastActivity">Last Activity</th>
        <th data-k="lastActivityDate">Date</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
}

function opsSection(p: ReportPayload): string {
  if (!p.opsPending.length && !p.opsSigned.length)
    return emptyState("No OPS plans on file.");
  return `
    <table class="tbl" id="opsTable">
      <thead><tr>
        <th data-k="id">OPS ID</th>
        <th data-k="title">Title</th>
        <th data-k="detective">Detective</th>
        <th data-k="risk">Risk</th>
        <th data-k="status">Status</th>
        <th data-k="signedBy">Signed By</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
}

const RENDERERS: Record<string, (p: ReportPayload) => string> = {
  metrics: metricsSection,
  activity: activitySection,
  trend: trendSection,
  breakdown: breakdownSection,
  workload: workloadSection,
  cases: casesSection,
  ops: opsSection,
};

export function renderReportHtml(p: ReportPayload): string {
  const who = [p.supervisor.name, p.supervisor.badge && `Badge ${p.supervisor.badge}`, p.supervisor.unit]
    .filter(Boolean)
    .join("  ·  ");

  const sections = p.sections
    .map(
      (s) => `
    <section id="sec-${esc(s)}">
      <h2>${esc(SECTION_TITLES[s] || s)}</h2>
      ${RENDERERS[s] ? RENDERERS[s](p) : ""}
    </section>`
    )
    .join("");

  const nav = p.sections
    .map((s) => `<a href="#sec-${esc(s)}">${esc(SECTION_TITLES[s] || s)}</a>`)
    .join("");

  const data = {
    cases: p.cases.map((c) => ({
      caseNumber: c.caseNumber,
      detective: c.detective,
      state: c.state,
      caseType: c.caseType,
      ageDays: c.ageDays,
      lastActivity: c.lastActivity,
      lastActivityDate: c.lastActivityDate,
    })),
    workload: p.workload,
    ops: [...slimOps(p.opsPending), ...slimOps(p.opsSigned)],
    breakdown: p.breakdown,
    totalCases: p.totalCases,
    series: p.series,
    activity: p.activity,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.title)} — V.I.P.E.R. Supervisor Edition</title>
<style>
:root{--cy:${C.cyan};--gr:${C.green};--am:${C.amber};--rd:${C.red};--pu:${C.purple};}
*{box-sizing:border-box}
body{margin:0;background:${C.bg};color:${C.text};
  font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;
  font-size:14px;line-height:1.5}
a{color:var(--cy);text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px 64px}
header{position:sticky;top:0;z-index:10;background:${C.panel3};
  border-bottom:1px solid ${C.border};padding:14px 24px}
.hdr{max-width:1180px;margin:0 auto;display:flex;align-items:flex-start;
  justify-content:space-between;gap:20px;flex-wrap:wrap}
h1{margin:0;font-size:19px;letter-spacing:.4px}
.sub{color:${C.dim};font-size:12px;margin-top:3px}
.conf{font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--am);
  border:1px solid var(--am);border-radius:999px;padding:3px 10px;white-space:nowrap}
nav{max-width:1180px;margin:10px auto 0;display:flex;gap:16px;flex-wrap:wrap;
  font-size:11px;text-transform:uppercase;letter-spacing:1px}
nav a{color:${C.faint}}nav a:hover{color:var(--cy)}
.btn{background:${C.panel2};border:1px solid ${C.border};color:${C.text};
  border-radius:7px;padding:6px 14px;font:inherit;font-size:12px;cursor:pointer}
.btn:hover{border-color:var(--cy);color:var(--cy)}
section{margin-top:34px}
h2{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--cy);
  margin:0 0 12px;padding-bottom:7px;border-bottom:1px solid ${C.border}}
.caveats{margin-top:26px;background:${C.panel3};border:1px solid ${C.border};
  border-left:3px solid var(--am);border-radius:8px;padding:12px 16px}
.caveats li{color:${C.dim};font-size:12px;margin:5px 0}
.empty{color:${C.faint};font-size:13px;padding:22px;text-align:center;
  background:${C.panel3};border:1px dashed ${C.border};border-radius:8px}
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
.mcard{background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:14px}
.mlabel{font-size:12px;color:${C.dim};margin-bottom:9px}
.mrow{display:flex;gap:20px}
.mval{font-size:25px;font-weight:600;color:var(--cy);line-height:1.05}
.mval.alt{color:${C.text}}
.mval.na{color:${C.faint}}
.mtag{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:${C.faint};margin-top:4px}
.mnote{font-size:10px;color:${C.faint};margin-top:9px;font-style:italic}
.chartbox{background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:14px}
.donutwrap{display:flex;gap:28px;align-items:center;flex-wrap:wrap;
  background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:16px}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px}
.legend.col{flex-direction:column;gap:7px;margin:0}
.lg{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;
  color:${C.dim};user-select:none}
.lg .sw{width:11px;height:11px;border-radius:3px;flex:none}
.lg.off{opacity:.35;text-decoration:line-through}
.lg .n{color:${C.text};font-variant-numeric:tabular-nums}
.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
input[type=search]{background:${C.panel3};border:1px solid ${C.border};color:${C.text};
  border-radius:7px;padding:7px 12px;font:inherit;font-size:13px;min-width:250px}
input[type=search]:focus{outline:none;border-color:var(--cy)}
.count{font-size:11px;color:${C.faint};text-transform:uppercase;letter-spacing:.8px}
.chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}
.chip{font-size:11px;padding:3px 11px;border-radius:999px;cursor:pointer;
  border:1px solid ${C.border};background:${C.panel3};color:${C.dim};user-select:none}
.chip.on{border-color:var(--cy);color:var(--cy);background:rgba(0,183,195,.12)}
.tbl{width:100%;border-collapse:collapse;background:${C.panel};
  border:1px solid ${C.border};border-radius:10px;overflow:hidden}
.tbl th{text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;
  color:${C.faint};background:${C.panel3};padding:9px 12px;cursor:pointer;
  white-space:nowrap;border-bottom:1px solid ${C.border}}
.tbl th:hover{color:var(--cy)}
.tbl th.num,.tbl td.num{text-align:right;font-variant-numeric:tabular-nums}
.tbl th.sorted{color:var(--cy)}
.tbl th.sorted::after{content:" \\25B4";font-size:9px}
.tbl th.sorted.desc::after{content:" \\25BE"}
.tbl td{padding:9px 12px;font-size:13px;border-bottom:1px solid ${C.border};color:${C.text}}
.tbl tbody tr:last-child td{border-bottom:none}
.tbl tbody tr:hover td{background:${C.panel2}}
.pill{font-size:10px;padding:2px 9px;border-radius:999px;white-space:nowrap;
  border:1px solid currentColor}
footer{margin-top:44px;padding-top:16px;border-top:1px solid ${C.border};
  color:${C.faint};font-size:11px}
.tip{position:fixed;pointer-events:none;background:${C.panel2};color:${C.text};
  border:1px solid ${C.border};border-radius:6px;padding:6px 10px;font-size:12px;
  opacity:0;transition:opacity .12s;z-index:50;white-space:nowrap}
@media print{
  body{background:#fff;color:#111}
  header{position:static;background:#fff;border-color:#ccc}
  nav,.btn,.toolbar,.chips,.tip{display:none!important}
  .mcard,.chartbox,.donutwrap,.tbl,.caveats{background:#fff;border-color:#bbb}
  .tbl th{background:#f2f2f2;color:#333}
  .tbl td,h1,.mval.alt{color:#111}
  .empty{color:#666}
  section{break-inside:avoid}
  .tbl tr{break-inside:avoid}
  a{color:#111}
}
</style>
</head>
<body>
<header>
  <div class="hdr">
    <div>
      <h1>${esc(p.title)}</h1>
      <div class="sub">${esc(p.scope.label)}  ·  ${esc(p.filterLabel)}  ·  Generated ${esc(
    new Date(p.generatedAt).toLocaleString()
  )}${who ? "  ·  " + esc(who) : ""}</div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <span class="conf">Confidential — Law Enforcement Use Only</span>
      <button class="btn" onclick="window.print()">Print</button>
    </div>
  </div>
  <nav>${nav}</nav>
</header>
<div class="wrap">
${sections}
  <div class="caveats"><ul>${p.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
  <footer>
    Generated locally by V.I.P.E.R. Supervisor Edition. Metadata only — no case
    narratives, evidence, media or notes are included. This file is fully
    self-contained and makes no network requests.
  </footer>
</div>
<div class="tip" id="tip"></div>
<script>
(function(){
"use strict";
var D = ${jsonForScript(data)};
var PAL = {cy:"${C.cyan}",gr:"${C.green}",am:"${C.amber}",rd:"${C.red}",pu:"${C.purple}",dim:"${C.dim}",faint:"${C.faint}",border:"${C.border}"};
var STATE_COLOR = {Open:PAL.cy, Ongoing:PAL.am, Closed:PAL.gr, Transferred:PAL.pu};
var BAND_COLOR  = {High:PAL.rd, Balanced:PAL.gr, Light:PAL.cy};

function el(tag, attrs, kids){
  var n = document.createElementNS(attrs && attrs._svg ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", tag);
  for (var k in attrs){ if(k==="_svg") continue; n.setAttribute(k, attrs[k]); }
  (kids||[]).forEach(function(c){ n.appendChild(typeof c==="string"?document.createTextNode(c):c); });
  return n;
}
function svg(tag, attrs, kids){ attrs=attrs||{}; attrs._svg=1; return el(tag, attrs, kids); }

var tip = document.getElementById("tip");
function showTip(e, html){
  tip.textContent = html;
  tip.style.opacity = "1";
  tip.style.left = (e.clientX + 14) + "px";
  tip.style.top  = (e.clientY - 10) + "px";
}
function hideTip(){ tip.style.opacity = "0"; }

// ---- sortable tables -----------------------------------------------------
function makeTable(id, rows, render, initialKey){
  var table = document.getElementById(id);
  if (!table) return null;
  var tbody = table.querySelector("tbody");
  var sortKey = initialKey, desc = false, extra = function(r){ return true; };

  function paint(){
    var out = rows.filter(extra).slice();
    out.sort(function(a,b){
      var x=a[sortKey], y=b[sortKey];
      if (typeof x==="number" && typeof y==="number") return desc? y-x : x-y;
      x=String(x==null?"":x).toLowerCase(); y=String(y==null?"":y).toLowerCase();
      return desc ? (x<y?1:x>y?-1:0) : (x>y?1:x<y?-1:0);
    });
    tbody.textContent = "";
    out.forEach(function(r){ tbody.appendChild(render(r)); });
    return out.length;
  }
  Array.prototype.forEach.call(table.querySelectorAll("th"), function(th){
    th.addEventListener("click", function(){
      var k = th.getAttribute("data-k");
      if (k === sortKey) desc = !desc; else { sortKey = k; desc = false; }
      Array.prototype.forEach.call(table.querySelectorAll("th"), function(o){
        o.classList.remove("sorted","desc");
      });
      th.classList.add("sorted"); if (desc) th.classList.add("desc");
      api.repaint();
    });
  });
  var api = {
    repaint: function(){ return paint(); },
    setFilter: function(fn){ extra = fn; return paint(); }
  };
  paint();
  return api;
}
function td(text, cls){ var d=el("td",cls?{"class":cls}:{},[String(text==null?"":text)]); return d; }
function pill(text, color){
  var s = el("span",{"class":"pill","style":"color:"+color},[String(text)]);
  var d = el("td",{}); d.appendChild(s); return d;
}

// ---- cases ---------------------------------------------------------------
var caseApi = makeTable("caseTable", D.cases, function(c){
  var tr = el("tr",{});
  tr.appendChild(td(c.caseNumber));
  tr.appendChild(td(c.detective));
  tr.appendChild(pill(c.state, STATE_COLOR[c.state] || PAL.dim));
  tr.appendChild(td(c.caseType));
  tr.appendChild(td(c.ageDays,"num"));
  tr.appendChild(td(c.lastActivity));
  tr.appendChild(td(c.lastActivityDate));
  return tr;
}, "caseNumber");

if (caseApi){
  var q = "", offStates = {};
  var search = document.getElementById("caseSearch");
  var countEl = document.getElementById("caseCount");
  function caseFilter(c){
    if (offStates[c.state]) return false;
    if (!q) return true;
    return [c.caseNumber,c.detective,c.state,c.caseType,c.lastActivity,c.lastActivityDate]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  }
  function refreshCases(){
    var n = caseApi.setFilter(caseFilter);
    countEl.textContent = "Showing " + n + " of " + D.cases.length;
  }
  search.addEventListener("input", function(){ q = search.value.trim().toLowerCase(); refreshCases(); });

  var chipWrap = document.getElementById("stateChips");
  var seen = [];
  D.cases.forEach(function(c){ if (seen.indexOf(c.state)===-1) seen.push(c.state); });
  seen.forEach(function(s){
    var chip = el("span",{"class":"chip on"},[s]);
    chip.addEventListener("click", function(){
      offStates[s] = !offStates[s];
      chip.className = "chip" + (offStates[s] ? "" : " on");
      refreshCases();
    });
    chipWrap.appendChild(chip);
  });
  refreshCases();
}

// ---- workload ------------------------------------------------------------
var wlApi = makeTable("workloadTable", D.workload, function(w){
  var tr = el("tr",{});
  tr.appendChild(td(w.name));
  tr.appendChild(td(w.total,"num"));
  tr.appendChild(td(w.open,"num"));
  tr.appendChild(td(w.ongoing,"num"));
  tr.appendChild(td(w.aging,"num"));
  tr.appendChild(td(w.newMtd,"num"));
  tr.appendChild(pill(w.band, BAND_COLOR[w.band] || PAL.dim));
  return tr;
}, "total");

if (wlApi){
  var offBands = {};
  var bandWrap = document.getElementById("bandChips");
  var bands = [];
  D.workload.forEach(function(w){ if (bands.indexOf(w.band)===-1) bands.push(w.band); });
  bands.forEach(function(b){
    var chip = el("span",{"class":"chip on"},[b]);
    chip.addEventListener("click", function(){
      offBands[b] = !offBands[b];
      chip.className = "chip" + (offBands[b] ? "" : " on");
      wlApi.setFilter(function(w){ return !offBands[w.band]; });
    });
    bandWrap.appendChild(chip);
  });
}

// ---- ops -----------------------------------------------------------------
makeTable("opsTable", D.ops, function(o){
  var tr = el("tr",{});
  tr.appendChild(td(o.id));
  tr.appendChild(td(o.title));
  tr.appendChild(td(o.detective));
  tr.appendChild(td(o.risk));
  tr.appendChild(pill(o.status, o.status==="Signed"?PAL.gr:o.status==="Returned"?PAL.rd:PAL.am));
  tr.appendChild(td(o.signedBy || "—"));
  return tr;
}, "id");

// ---- donut ---------------------------------------------------------------
(function(){
  var host = document.getElementById("donut");
  if (!host || !D.breakdown.length) return;
  var R = 78, r = 50, cx = 95, cy = 95, total = D.totalCases || 1;
  var s = svg("svg",{width:190,height:190,viewBox:"0 0 190 190"});
  var acc = -Math.PI/2, arcs = [];
  D.breakdown.forEach(function(b){
    var frac = total ? b.count/total : 0;
    var a0 = acc, a1 = acc + frac*Math.PI*2; acc = a1;
    // A full-circle single slice cannot be drawn as an arc — use a ring.
    var node;
    if (frac >= 0.9999){
      node = svg("circle",{cx:cx,cy:cy,r:(R+r)/2,fill:"none",
        stroke:STATE_COLOR[b.state]||PAL.dim,"stroke-width":(R-r)});
    } else {
      var large = (a1-a0) > Math.PI ? 1 : 0;
      var p = [
        "M", cx+R*Math.cos(a0), cy+R*Math.sin(a0),
        "A", R, R, 0, large, 1, cx+R*Math.cos(a1), cy+R*Math.sin(a1),
        "L", cx+r*Math.cos(a1), cy+r*Math.sin(a1),
        "A", r, r, 0, large, 0, cx+r*Math.cos(a0), cy+r*Math.sin(a0), "Z"
      ].join(" ");
      node = svg("path",{d:p,fill:STATE_COLOR[b.state]||PAL.dim});
    }
    node.style.cursor = "pointer";
    node.style.transition = "opacity .12s";
    arcs.push({node:node, slice:b});
    s.appendChild(node);
  });
  s.appendChild(svg("text",{x:cx,y:cy-2,"text-anchor":"middle","font-size":"26",
    "font-weight":"600",fill:"#fff"},[String(D.totalCases)]));
  s.appendChild(svg("text",{x:cx,y:cy+16,"text-anchor":"middle","font-size":"8",
    "letter-spacing":"1.4",fill:PAL.faint},["TOTAL CASES"]));
  host.appendChild(s);

  var lg = document.getElementById("donutLegend");
  arcs.forEach(function(a){
    var row = el("div",{"class":"lg"},[]);
    row.appendChild(el("span",{"class":"sw","style":"background:"+(STATE_COLOR[a.slice.state]||PAL.dim)},[]));
    row.appendChild(el("span",{},[a.slice.state]));
    row.appendChild(el("span",{"class":"n"},[String(a.slice.count)+" ("+a.slice.pct+"%)"]));
    function on(){ arcs.forEach(function(o){ o.node.style.opacity = o===a?"1":"0.28"; }); row.style.color="#fff"; }
    function off(){ arcs.forEach(function(o){ o.node.style.opacity="1"; }); row.style.color=""; }
    row.addEventListener("mouseenter", on); row.addEventListener("mouseleave", off);
    a.node.addEventListener("mouseenter", on); a.node.addEventListener("mouseleave", off);
    a.node.addEventListener("mousemove", function(e){
      showTip(e, a.slice.state+": "+a.slice.count+" ("+a.slice.pct+"%)");
    });
    a.node.addEventListener("mouseleave", hideTip);
    lg.appendChild(row);
  });
})();

// ---- trend (grouped bars) ------------------------------------------------
(function(){
  var host = document.getElementById("trendChart");
  if (!host || !D.series.length) return;
  var SER = [
    {k:"opened",  label:"Opened",  color:PAL.cy},
    {k:"closed",  label:"Closed",  color:PAL.gr},
    {k:"arrests", label:"Arrests", color:PAL.pu},
    {k:"warrants",label:"Warrants",color:PAL.am}
  ];
  var hidden = {};
  var W = 900, H = 260, PADL = 38, PADB = 30, PADT = 12, PADR = 10;

  function draw(){
    host.textContent = "";
    var vis = SER.filter(function(s){ return !hidden[s.k]; });
    var max = 0;
    D.series.forEach(function(b){ vis.forEach(function(s){ if (b[s.k] > max) max = b[s.k]; }); });
    if (max <= 0) max = 1; // never divide by zero on an all-zero window
    var plotW = W - PADL - PADR, plotH = H - PADT - PADB;
    var s = svg("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",height:H});

    // gridlines + y labels
    for (var i=0;i<=4;i++){
      var yy = PADT + plotH - (plotH*i/4);
      s.appendChild(svg("line",{x1:PADL,y1:yy,x2:W-PADR,y2:yy,stroke:PAL.border,"stroke-width":1}));
      s.appendChild(svg("text",{x:PADL-7,y:yy+3,"text-anchor":"end","font-size":"9",fill:PAL.faint},
        [String(Math.round(max*i/4))]));
    }

    var slot = plotW / D.series.length;
    var bw = vis.length ? Math.max(3, Math.min(17, (slot*0.68)/vis.length)) : 0;
    D.series.forEach(function(b, bi){
      var groupW = bw*vis.length;
      var x0 = PADL + slot*bi + (slot-groupW)/2;
      vis.forEach(function(ser, si){
        var v = b[ser.k] || 0;
        var h = (v/max)*plotH;
        var x = x0 + si*bw;
        var rect = svg("rect",{x:x,y:PADT+plotH-h,width:Math.max(bw-2,1),height:Math.max(h,0),
          fill:ser.color,rx:2});
        rect.style.cursor="pointer";
        rect.addEventListener("mousemove",function(e){ showTip(e, b.label+" · "+ser.label+": "+v); });
        rect.addEventListener("mouseleave",hideTip);
        s.appendChild(rect);
      });
      s.appendChild(svg("text",{x:PADL+slot*bi+slot/2,y:H-10,"text-anchor":"middle",
        "font-size":"9",fill:PAL.faint},[b.label]));
    });
    host.appendChild(s);
  }

  var lg = document.getElementById("trendLegend");
  SER.forEach(function(ser){
    var row = el("div",{"class":"lg"},[]);
    row.appendChild(el("span",{"class":"sw","style":"background:"+ser.color},[]));
    row.appendChild(el("span",{},[ser.label]));
    row.addEventListener("click", function(){
      hidden[ser.k] = !hidden[ser.k];
      row.className = "lg" + (hidden[ser.k] ? " off" : "");
      draw();
    });
    lg.appendChild(row);
  });
  draw();
})();

// ---- activity (horizontal bars) -----------------------------------------
(function(){
  var host = document.getElementById("activityChart");
  if (!host) return;
  var rows = D.activity.filter(function(a){ return a.value > 0; });
  if (!rows.length) return;
  var max = rows.reduce(function(m,a){ return a.value>m?a.value:m; }, 0) || 1;
  var RH = 26, LBL = 190, W = 900, H = rows.length*RH + 8;
  var s = svg("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",height:H});
  rows.forEach(function(a, i){
    var y = i*RH + 4;
    s.appendChild(svg("text",{x:LBL-10,y:y+15,"text-anchor":"end","font-size":"11",fill:PAL.dim},[a.label]));
    var w = Math.max(2, (a.value/max)*(W-LBL-70));
    var bar = svg("rect",{x:LBL,y:y+4,width:w,height:14,fill:PAL.cy,rx:3});
    bar.addEventListener("mousemove",function(e){ showTip(e, a.label+": "+a.value); });
    bar.addEventListener("mouseleave",hideTip);
    s.appendChild(bar);
    s.appendChild(svg("text",{x:LBL+w+9,y:y+15,"font-size":"11",fill:"#fff"},[String(a.value)]));
  });
  host.appendChild(s);
})();
})();
</script>
</body>
</html>`;
}

/** Render + wrap as a downloadable blob. The caller owns saving/archiving. */
export async function exportReportHtml(
  p: ReportPayload
): Promise<{ filename: string; blob: Blob }> {
  const html = renderReportHtml(p);
  return {
    filename: reportFilename(p, "html"),
    blob: new Blob([html], { type: "text/html;charset=utf-8" }),
  };
}
