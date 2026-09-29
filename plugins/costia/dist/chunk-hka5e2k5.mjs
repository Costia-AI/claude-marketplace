import{n,o,u,O,K,G,P,C,f,_,W,Y,N,S,v,R,d,s,p,c}from"./costia.mjs";import{j,Q}from"./chunk-st3fy0hp.mjs";import{createServer as Me}from"node:http";import{spawn as Ee}from"node:child_process";import{generateKeyPairSync as Le,randomBytes as ae,timingSafeEqual as _e}from"node:crypto";function ye(a){let h=(T)=>T.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),r=(T)=>{let I=[],J=h(T).replace(/`([^`]+)`/g,(A,M)=>(I.push(M),`${I.length-1}`));return J=J.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(A,M,z)=>`<a href="${z}" target="_blank" rel="noopener noreferrer">${M}</a>`).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g,"$1<em>$2</em>").replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:)])/g,(A,M,z)=>`${M}<a href="${z}" target="_blank" rel="noopener noreferrer">${z}</a>`),J.replace(/\uE000(\d+)\uE000/g,(A,M)=>`<code>${I[Number(M)]}</code>`)},t=a.replace(/\r\n/g,`
`).split(`
`),w=[],k=[],y=null,U=()=>{if(k.length)w.push(`<p>${r(k.join(" "))}</p>`);k=[]},D=()=>{if(y)w.push(`<${y.ordered?"ol":"ul"}>${y.items.map((T)=>`<li>${r(T)}</li>`).join("")}</${y.ordered?"ol":"ul"}>`);y=null};for(let T=0;T<t.length;T++){let I=t[T];if(/^\s*```/.exec(I)){U(),D();let z=[];T+=1;while(T<t.length&&!/^\s*```/.test(t[T]))z.push(t[T++]);w.push(`<pre><code>${h(z.join(`
`))}</code></pre>`);continue}let A=/^(#{1,4})\s+(.*)$/.exec(I);if(A){U(),D();let z=Math.min(A[1].length+2,6);w.push(`<h${z}>${r(A[2])}</h${z}>`);continue}let M=/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(I);if(M){U();let z=M[2]!==void 0;if(y&&y.ordered!==z)D();if(!y)y={ordered:z,items:[]};y.items.push(M[3]);continue}if(y&&/^\s{2,}\S/.test(I)){y.items[y.items.length-1]+=` ${I.trim()}`;continue}if(!I.trim()){U(),D();continue}D(),k.push(I.trim())}return U(),D(),w.join(`
`)}function xe(a){return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Costia · Set up</title>
<style nonce="${a}">${Te}</style>
</head>
<body>
<div id="app" class="shell"><div class="loading">Loading…</div></div>
<script nonce="${a}">
const md = (${ye.toString()});
${Pe}
</script>
</body>
</html>`}var Te=String.raw`
:root {
  --bg: #fafaf9; --panel: #ffffff; --sunken: #f5f5f4; --ink: #1c1917; --muted: #78716c; --line: #e7e5e4;
  --accent: #c2410c; --accent-soft: #fff7ed; --accent-ink: #ffffff; --ok: #15803d; --ok-soft: #f0fdf4;
  --warn: #b45309; --bad: #b91c1c; --bad-soft: #fef2f2; --radius: 14px;
  --shadow: 0 1px 2px rgb(28 25 23 / .04), 0 8px 24px -12px rgb(28 25 23 / .12);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09; --panel: #1c1917; --sunken: #141211; --ink: #f5f5f4; --muted: #a8a29e; --line: #292524;
    --accent: #fb923c; --accent-soft: #2a1a0f; --accent-ink: #1c1917; --ok: #4ade80; --ok-soft: #0f1f14;
    --warn: #fbbf24; --bad: #f87171; --bad-soft: #2a1212; --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 12px 32px -16px rgb(0 0 0 / .6);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body { font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: .88em; }
a { color: var(--accent); text-underline-offset: 2px; }
.shell { max-width: 820px; margin: 0 auto; padding: 32px 16px 140px; }
.loading { color: var(--muted); padding: 80px 0; text-align: center; }
header.top { display: flex; gap: 14px; align-items: center; margin-bottom: 20px; }
.mark { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; flex: none;
  background: linear-gradient(135deg, #fb923c, #c2410c 55%, #7c2d12); color: #fff; font: 700 17px/1 ui-monospace, monospace; box-shadow: var(--shadow); }
h1 { font-size: 22px; line-height: 1.25; margin: 0; letter-spacing: -.01em; }
.sub { color: var(--muted); font-size: 14px; margin-top: 2px; }
.items { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 20px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); font-size: 12.5px; color: var(--muted); }
.pill b { color: var(--ink); font-weight: 600; }
.progress { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.bar { flex: 1; height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.bar > i { display: block; height: 100%; background: linear-gradient(90deg, #fb923c, var(--accent)); border-radius: inherit; transition: width .4s ease; }
.progress span { font-size: 13px; color: var(--muted); white-space: nowrap; }
.flow { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 18px; overflow: hidden; }
.flow > .head { padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }
.flow h2 { font-size: 16px; margin: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.flow h2 .mono { color: var(--muted); font-weight: 400; font-size: 12px; }
.flow .summary { color: var(--muted); font-size: 14px; margin: 4px 0 0; }
.notice { margin: 10px 0 0; padding: 8px 12px; border-radius: 10px; font-size: 13.5px; background: var(--accent-soft); color: var(--ink); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.notice.bad { background: var(--bad-soft); border-color: color-mix(in srgb, var(--bad) 35%, transparent); }
details.step { border-bottom: 1px solid var(--line); }
details.step:last-of-type { border-bottom: 0; }
details.step > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 13px 18px; user-select: none; }
details.step > summary::-webkit-details-marker { display: none; }
details.step > summary:hover { background: var(--sunken); }
.dot { width: 24px; height: 24px; border-radius: 999px; flex: none; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 1.5px solid var(--line); color: var(--muted); background: var(--panel); }
.done .dot { background: var(--ok); border-color: var(--ok); color: var(--panel); }
.failed .dot { border-color: var(--bad); color: var(--bad); }
.claude .dot { border-style: dashed; }
.title { flex: 1; min-width: 0; font-weight: 550; }
.done .title { color: var(--muted); font-weight: 450; }
.meta { font-size: 12px; color: var(--muted); font-weight: 400; display: block; }
.chip { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; border: 1px solid var(--line); color: var(--muted); }
.chip.machine { color: #0e7490; border-color: color-mix(in srgb, #0e7490 35%, transparent); }
.chip.user { color: #7c3aed; border-color: color-mix(in srgb, #7c3aed 35%, transparent); }
.chip.project { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.chip.project_user { color: #be185d; border-color: color-mix(in srgb, #be185d 35%, transparent); }
@media (prefers-color-scheme: dark) {
  .chip.machine { color: #67e8f9; } .chip.user { color: #c4b5fd; } .chip.project_user { color: #f9a8d4; }
}
.body { padding: 2px 18px 18px 54px; }
.md { color: var(--ink); }
.md p { margin: 8px 0; } .md ul, .md ol { margin: 8px 0; padding-left: 22px; } .md li { margin: 3px 0; }
.md h3, .md h4, .md h5, .md h6 { margin: 14px 0 6px; font-size: 14.5px; }
.md code { background: var(--sunken); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; }
.md pre { background: var(--sunken); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; overflow-x: auto; }
.md pre code { background: none; border: 0; padding: 0; }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
button, .btn { font: inherit; font-size: 14px; font-weight: 600; border-radius: 10px; padding: 8px 14px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; transition: transform .06s ease, background .15s; }
button:hover { background: var(--sunken); }
button:active { transform: translateY(1px); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
button.primary:hover { background: color-mix(in srgb, var(--accent) 88%, black); }
button.ghost { border-color: transparent; background: transparent; color: var(--muted); font-weight: 500; padding: 6px 8px; }
button:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.fields { display: grid; gap: 12px; margin-top: 12px; }
label.field { display: grid; gap: 4px; font-size: 13.5px; font-weight: 600; }
label.field small { font-weight: 400; color: var(--muted); }
input[type=text], input[type=url], input[type=password], select, textarea { font: inherit; font-size: 14px; color: var(--ink); background: var(--panel);
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; width: 100%; }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: 1px; }
input:disabled { color: var(--muted); background: var(--sunken); }
textarea { min-height: 84px; resize: vertical; }
.drop { margin-top: 12px; border: 1.5px dashed var(--line); border-radius: 12px; padding: 18px; text-align: center; color: var(--muted); font-size: 14px; cursor: pointer; transition: border-color .15s, background .15s; }
.drop.over, .drop:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.drop input { display: none; }
.where { margin-top: 10px; font-size: 13px; color: var(--muted); }
.result { margin-top: 10px; font-size: 13.5px; padding: 7px 11px; border-radius: 9px; }
.result.ok { background: var(--ok-soft); color: var(--ok); }
.result.bad { background: var(--bad-soft); color: var(--bad); }
.prompt { margin-top: 10px; }
.prompt summary { cursor: pointer; color: var(--muted); font-size: 13px; }
.adder { padding: 10px 18px 16px; border-top: 1px solid var(--line); background: var(--sunken); }
.adder > summary { cursor: pointer; font-size: 13.5px; color: var(--muted); }
.adder .fields { max-width: 560px; }
.local { display: flex; gap: 10px; align-items: center; padding: 8px 18px 8px 54px; font-size: 14px; border-top: 1px dashed var(--line); }
footer.dock { position: fixed; left: 0; right: 0; bottom: 0; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(12px); border-top: 1px solid var(--line); }
footer .inner { max-width: 820px; margin: 0 auto; padding: 14px 16px; display: flex; gap: 12px; align-items: center; }
footer .status { flex: 1; font-size: 14px; color: var(--muted); }
.verify { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 6px; }
.verify li { display: flex; gap: 8px; font-size: 13.5px; }
.verify .ok { color: var(--ok); } .verify .bad { color: var(--bad); }
.finish { text-align: center; padding: 56px 16px; }
.finish .big { width: 64px; height: 64px; border-radius: 999px; margin: 0 auto 16px; display: grid; place-items: center; font-size: 30px; background: var(--ok); color: var(--panel); box-shadow: var(--shadow); }
.finish h1 { font-size: 24px; }
.finish p { color: var(--muted); max-width: 520px; margin: 10px auto; }
.toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 9px 14px; border-radius: 10px; font-size: 14px; box-shadow: var(--shadow); z-index: 9; max-width: 90vw; }
.spin { display: inline-block; width: 14px; height: 14px; border-radius: 999px; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 560px) { .body { padding-left: 18px; } .local { padding-left: 18px; } h1 { font-size: 19px; } }
`,Pe=String.raw`
const BASE = location.pathname.replace(/\/+$/, "").replace(/\/(index\.html)?$/, "");
const TOKEN = BASE.split("/").pop();
const SCOPE = { machine: "This computer", user: "You", project: "Project", project_user: "You in this project" };
const app = document.getElementById("app");
let plan = null;
let results = {};
let busy = null;
let verify = null;
let finished = null;
let locals = {};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

async function api(path, body, raw) {
  const init = { method: body === undefined ? "GET" : "POST", headers: { "x-costia-wizard": TOKEN } };
  if (raw) { init.body = body; init.headers["content-type"] = "application/octet-stream"; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
  const response = await fetch(BASE + "/api/" + path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function load() {
  try { plan = await api("plan"); render(); }
  catch (e) { app.innerHTML = '<div class="finish"><h1>This setup page has closed</h1><p>' + esc(e.message) + '</p></div>'; }
}

function allSteps() { return plan.flows.flatMap((f) => f.steps.map((s) => ({ flow: f, step: s }))); }
function humanPending() { return allSteps().filter(({ step }) => !step.done && step.type !== "claude"); }

function fieldFor(flow, key) {
  const p = flow.params.find((x) => x.key === key);
  if (!p) return "";
  const id = "f-" + flow.id + "-" + key;
  const hint = p.description ? "<small>" + esc(p.description) + "</small>" : "";
  const label = esc(p.label || key);
  if (p.type === "boolean") {
    return '<label class="field"><span><input type="checkbox" name="' + esc(key) + '" ' + (p.value === "true" ? "checked" : "") + (p.fixed ? " disabled" : "") + "> " + label + "</span>" + hint + "</label>";
  }
  if (p.type === "enum") {
    const opts = (p.options || []).map((o) => '<option value="' + esc(o) + '"' + (o === p.value ? " selected" : "") + ">" + esc(o) + "</option>").join("");
    return '<label class="field" for="' + id + '">' + label + hint + '<select id="' + id + '" name="' + esc(key) + '"' + (p.fixed ? " disabled" : "") + ">" + opts + "</select></label>";
  }
  return '<label class="field" for="' + id + '">' + label + hint + '<input id="' + id + '" name="' + esc(key) + '" type="' + (p.type === "url" ? "url" : "text") + '" value="' + esc(p.value) + '"' +
    (p.pattern ? ' pattern="' + esc(p.pattern) + '"' : "") + (p.fixed ? " disabled" : "") + ' autocomplete="off" spellcheck="false"></label>';
}

function controls(flow, step) {
  const key = flow.id + "/" + step.id;
  const working = busy === key;
  const spin = working ? '<span class="spin"></span> ' : "";
  if (step.type === "claude") {
    return '<div class="where">Claude does this in the repository once the files are in place.</div>' +
      '<details class="prompt"><summary>What Claude will be asked</summary><div class="md">' + md(step.prompt || "") + "</div></details>";
  }
  if (step.done && !(step.type === "secret" && step.rotate)) {
    return '<div class="controls">' + (step.hasCheck ? '<button data-act="check" data-key="' + esc(key) + '"' + (working ? " disabled" : "") + ">" + spin + "Check again</button>" : "") +
      '<button class="ghost" data-act="reset" data-key="' + esc(key) + '">Mark as not done</button></div>';
  }
  if (step.type === "check") {
    return '<div class="controls"><button class="primary" data-act="check" data-key="' + esc(key) + '"' + (working ? " disabled" : "") + ">" + spin + "Check</button>" +
      (step.checkLabel ? '<span class="where">' + esc(step.checkLabel) + "</span>" : "") + "</div>";
  }
  if (step.type === "confirm") {
    return '<div class="controls"><button class="primary" data-act="done" data-key="' + esc(key) + '"' + (working ? " disabled" : "") + ">" + spin + "I have done this</button>" +
      (step.checkLabel ? '<span class="where">then: ' + esc(step.checkLabel) + "</span>" : "") + "</div>";
  }
  if (step.type === "input") {
    return '<form data-form="input" data-key="' + esc(key) + '"><div class="fields">' + (step.params || []).map((k) => fieldFor(flow, k)).join("") +
      '</div><div class="controls"><button class="primary" type="submit"' + (working ? " disabled" : "") + ">" + spin + "Save</button></div></form>";
  }
  if (step.type === "secret") {
    const s = step.secret || {};
    const where = '<div class="where">Stored in Infisical as <code>' + esc(s.name) + "</code> in <code>" + esc(s.project) + "/" + esc(s.env) + (s.path && s.path !== "/" ? esc(s.path) : "") +
      "</code>. It goes straight from this page to Infisical: never to Costia, never to Claude.</div>";
    const verb = step.done ? "Rotate" : "Store";
    let input = "";
    if (s.source === "file") {
      input = '<label class="drop" data-drop="' + esc(key) + '">' + (working ? '<span class="spin"></span> Sending…' : "Drop the file here or <u>choose it</u>" + (s.accept ? " (" + esc(s.accept) + ")" : "")) +
        '<input type="file" data-file="' + esc(key) + '"' + (s.accept ? ' accept="' + esc(s.accept) + '"' : "") + "></label>";
    } else if (s.source === "text") {
      input = '<form data-form="secret" data-key="' + esc(key) + '"><div class="fields"><input type="password" name="value" autocomplete="off" placeholder="Paste the value"></div>' +
        '<div class="controls"><button class="primary" type="submit"' + (working ? " disabled" : "") + ">" + spin + verb + "</button></div></form>";
    } else {
      input = '<div class="controls"><button class="primary" data-act="generate" data-key="' + esc(key) + '"' + (working ? " disabled" : "") + ">" + spin + (step.done ? "Generate a new value" : "Generate and store") + "</button></div>";
    }
    return (step.done ? '<div class="where"><b>Rotate:</b> store a new value; whatever reads it picks it up on its next run.</div>' : "") + input + where;
  }
  return "";
}

function stepHtml(flow, step, index, openKey) {
  const key = flow.id + "/" + step.id;
  const r = results[key];
  const cls = ["step", step.done ? "done" : "", r && !r.ok ? "failed" : "", step.type === "claude" ? "claude" : ""].join(" ");
  const meta = step.done ? (step.doneBy ? "Done by " + esc(step.doneBy) : "Done") + (step.doneAt ? " · " + esc(when(step.doneAt)) : "") : step.type === "claude" ? "After the files are in place" : "";
  return '<details class="' + cls + '"' + (openKey === key ? " open" : "") + ' data-step="' + esc(key) + '"><summary><span class="dot">' + (step.done ? "✓" : r && !r.ok ? "!" : index + 1) +
    '</span><span class="title">' + esc(step.title) + (meta ? '<span class="meta">' + meta + "</span>" : "") + '</span><span class="chip ' + esc(step.scope) + '">' + esc(SCOPE[step.scope] || step.scope) + "</span></summary>" +
    '<div class="body"><div class="md">' + md(step.instructions || "") + "</div>" + controls(flow, step) +
    (r ? '<div class="result ' + (r.ok ? "ok" : "bad") + '">' + esc(r.reason) + "</div>" : "") + "</div></details>";
}

function render() {
  if (finished) return renderFinished();
  const steps = allSteps();
  const done = steps.filter(({ step }) => step.done).length;
  const pending = humanPending();
  const openKey = pending[0] ? pending[0].flow.id + "/" + pending[0].step.id : null;
  const open = new Set([...document.querySelectorAll("details.step[open]")].map((d) => d.dataset.step));
  let html = '<header class="top"><div class="mark">&gt;_</div><div><h1>Set up ' + esc(plan.title) + '</h1><div class="sub">' +
    esc(plan.context === "user" ? "For your own ~/.claude, on every machine" : "For the project " + (plan.projectName || "")) + " · " + esc(plan.os) + "</div></div></header>";
  if (plan.items && plan.items.length) html += '<div class="items">' + plan.items.map((i) => '<span class="pill">' + esc(i.kind.toLowerCase().replace("_", " ")) + " <b>" + esc(i.name) + "</b></span>").join("") + "</div>";
  html += '<div class="progress"><div class="bar"><i style="width:' + (steps.length ? Math.round((done / steps.length) * 100) : 100) + '%"></i></div><span>' + done + " of " + steps.length + " steps done</span></div>";
  for (const flow of plan.flows) {
    html += '<section class="flow"><div class="head"><h2>' + esc(flow.name) + ' <span class="mono">' + esc(flow.ref) + " v" + esc(flow.version) + "</span></h2>" +
      (flow.summary ? '<p class="summary">' + esc(flow.summary) + "</p>" : "") +
      (flow.errors.length ? '<div class="notice bad">This flow is not valid and cannot run: ' + esc(flow.errors.join("; ")) + "</div>" : "") +
      (flow.approvals.length ? '<div class="notice">This flow runs a program to check itself (' + esc(flow.approvals.join(", ")) + "). Approve it first with <code>/costia:sync</code> in Claude Code, or on the web's approvals page, then reload.</div>" : "") +
      "</div>";
    flow.steps.forEach((step, i) => {
      const key = flow.id + "/" + step.id;
      html += stepHtml(flow, step, i, open.size ? (open.has(key) ? key : null) : openKey);
    });
    for (const [i, l] of (locals[flow.id] || []).entries()) {
      html += '<label class="local"><input type="checkbox" data-local="' + esc(flow.id) + ":" + i + '"' + (l.done ? " checked" : "") + "> " + esc(l.title) + ' <span class="chip">draft</span></label>';
    }
    html += '<details class="adder"><summary>+ Add a step to this flow</summary><form data-form="draft" data-flow="' + esc(flow.id) + '"><div class="fields">' +
      '<label class="field">What has to be done<input type="text" name="title" maxlength="120" required></label>' +
      '<label class="field">Instructions <small>Markdown. Saved as a draft version of the flow, never published from here.</small><textarea name="instructions"></textarea></label>' +
      '<label class="field">Who does it<select name="scope">' + Object.entries(SCOPE).map(([k, v]) => '<option value="' + k + '">' + esc(v) + "</option>").join("") + "</select></label>" +
      '</div><div class="controls"><button type="submit">Save as draft</button></div></form></details></section>';
  }
  if (verify) {
    html += '<section class="flow"><div class="head"><h2>Final checks</h2><ul class="verify">' + verify.map((v) => '<li><span class="' + (v.ok ? "ok" : "bad") + '">' + (v.ok ? "✓" : "✗") + "</span><span><b>" + esc(v.flow) + "</b> — " + esc(v.label) + ": " + esc(v.reason) + "</span></li>").join("") + "</ul></div></section>";
  }
  const ready = !pending.length && plan.flows.every((f) => !f.errors.length);
  html += '<footer class="dock"><div class="inner"><div class="status">' + (ready ? "Every step is done. Run the final checks to install." : pending.length + " step" + (pending.length === 1 ? "" : "s") + " left") +
    '</div><button class="ghost" data-act="abort">Cancel</button><button class="primary" data-act="verify"' + (!ready || busy ? " disabled" : "") + ">" + (busy === "verify" ? '<span class="spin"></span> Checking…' : "Verify and install") + "</button></div></footer>";
  app.innerHTML = html;
}

function renderFinished() {
  const claude = finished.claudeSteps || [];
  app.innerHTML = '<div class="finish"><div class="big">✓</div><h1>' + esc(finished.title || "All set") + "</h1><p>" + esc(finished.message || "") + "</p>" +
    (claude.length ? "<p>Claude now takes it from here: " + claude.map((c) => "<b>" + esc(c.title) + "</b>").join(", ") + ".</p>" : "") +
    "<p>You can close this tab.</p></div>";
}

async function act(key, fn) {
  busy = key; render();
  try { await fn(); }
  catch (e) { if (key !== "verify") results[key] = { ok: false, reason: e.message }; toast(e.message); }
  finally { busy = null; if (!finished) { plan = await api("plan").catch(() => plan); render(); } }
}

function findStep(key) {
  const [flowId, stepId] = key.split("/");
  const flow = plan.flows.find((f) => f.id === flowId);
  return { flow, step: flow && flow.steps.find((s) => s.id === stepId), flowId, stepId };
}

async function stepCall(key, action, extra) {
  const { flowId, stepId } = findStep(key);
  const r = await api("steps/" + action, Object.assign({ flow: flowId, step: stepId }, extra || {}));
  results[key] = r;
  if (!r.ok) toast(r.reason);
}

async function sendFile(key, file) {
  const { flowId, stepId, step } = findStep(key);
  const max = (step.secret && step.secret.maxBytes) || 65536;
  if (file.size > max) return toast("The file is larger than " + max + " bytes.");
  await act(key, async () => {
    const r = await api("steps/secret?flow=" + encodeURIComponent(flowId) + "&step=" + encodeURIComponent(stepId), await file.arrayBuffer(), true);
    results[key] = r;
    if (!r.ok) toast(r.reason);
  });
}

app.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-act]");
  if (!el) return;
  event.preventDefault();
  const key = el.dataset.key;
  const action = el.dataset.act;
  if (action === "check" || action === "done" || action === "reset") return act(key, () => stepCall(key, action));
  if (action === "generate") return act(key, () => stepCall(key, "secret-generate"));
  if (action === "abort") {
    await api("abort", {}).catch(() => {});
    finished = { title: "Setup cancelled", message: "Nothing was installed. Run /costia:install again whenever you are ready." };
    return render();
  }
  if (action === "verify") {
    busy = "verify"; render();
    try {
      const r = await api("verify", {});
      verify = r.results;
      if (r.completed) finished = { title: "Installed", message: r.message, claudeSteps: r.claudeSteps };
      else toast(r.message || "Some checks failed.");
    } catch (e) { toast(e.message); }
    busy = null;
    if (!finished) plan = await api("plan").catch(() => plan);
    render();
  }
});

app.addEventListener("change", (event) => {
  const file = event.target.closest("[data-file]");
  if (file && file.files[0]) return sendFile(file.dataset.file, file.files[0]);
  const local = event.target.closest("[data-local]");
  if (local) { const [f, i] = local.dataset.local.split(":"); locals[f][Number(i)].done = local.checked; }
});

app.addEventListener("dragover", (event) => { const d = event.target.closest("[data-drop]"); if (d) { event.preventDefault(); d.classList.add("over"); } });
app.addEventListener("dragleave", (event) => { const d = event.target.closest("[data-drop]"); if (d) d.classList.remove("over"); });
app.addEventListener("drop", (event) => {
  const d = event.target.closest("[data-drop]");
  if (!d) return;
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) sendFile(d.dataset.drop, file);
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "input") {
    const key = form.dataset.key;
    const values = {};
    for (const el of form.querySelectorAll("input[name], select[name]")) {
      if (el.disabled) continue;
      values[el.name] = el.type === "checkbox" ? String(el.checked) : el.value.trim();
    }
    return act(key, () => stepCall(key, "input", { values }));
  }
  if (kind === "secret") {
    const key = form.dataset.key;
    const input = form.querySelector("input[name=value]");
    const text = input.value;
    input.value = "";
    if (!text) return toast("Paste a value first.");
    return act(key, () => stepCall(key, "secret-text", { text }));
  }
  if (kind === "draft") {
    const flow = form.dataset.flow;
    const data = Object.fromEntries(new FormData(form));
    try {
      const r = await api("drafts", { flow, title: data.title, instructions: data.instructions, scope: data.scope });
      (locals[flow] = locals[flow] || []).push({ title: data.title, done: false });
      toast(r.message);
      render();
    } catch (e) { toast(e.message); }
  }
});

load();
`;var Oe=1052672;class L extends Error{status;constructor(a,h){super(h);this.status=a}}function Re(a,h){return new Promise((r,t)=>{let w=[],k=0;a.on("data",(y)=>{if(k+=y.length,k>h){t(new L(413,"too large")),a.destroy();return}w.push(y)}),a.on("end",()=>r(Buffer.concat(w))),a.on("error",t)})}function ke(a,h){if(!a)return!1;let r=Buffer.from(a),t=Buffer.from(h);return r.length===t.length&&_e(r,t)}function Be(a){let[h,r]=process.platform==="darwin"?["open",[a]]:process.platform==="win32"?["cmd",["/c","start","",a]]:["xdg-open",[a]];try{let t=Ee(h,r,{detached:!0,stdio:"ignore"});return t.on("error",()=>{}),t.unref(),!0}catch{return!1}}function Ne(a){let h=a.generate??{kind:"random"};if(h.kind==="rsa"){let{privateKey:y}=Le("rsa",{modulusLength:h.bits??2048});return y.export({type:"pkcs8",format:"pem"}).toString()}let r=Math.min(Math.max(h.length??40,16),256),t=h.charset??"alnum";if(t==="hex")return ae(Math.ceil(r/2)).toString("hex").slice(0,r);if(t==="base64url")return ae(r).toString("base64url").slice(0,r);let w="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",k="";while(k.length<r)for(let y of ae(r))if(y<248&&k.length<r)k+=w[y%62];return k}function Fe(a,h,r){let t=a.entry.spec.params?.find((w)=>w.key===h);if(!t)return`unknown parameter ${h}`;if(r.length>2000)return`${t.label??h} is longer than 2000 characters`;if(t.type==="boolean"&&r!=="true"&&r!=="false")return`${t.label??h} must be true or false`;if(t.type==="enum"&&!(t.options??[]).includes(r))return`${t.label??h} must be one of ${(t.options??[]).join(", ")}`;if(t.type==="url"&&!/^https?:\/\/\S+$/.test(r))return`${t.label??h} must be a URL`;if(!r)return t.optional?null:`${t.label??h} is required`;if(t.pattern&&!new RegExp(t.pattern).test(r))return`${t.label??h} does not match ${t.pattern}`;return null}async function rt(a){let h=a.out??((l)=>process.stdout.write(`${l}
`)),r=(l)=>h(JSON.stringify(l)),t=a.target??".",w,k,y,U="",D=a.user?null:o(a.checkout??process.cwd());if(a.user)w={user:!0};else{if(!D)throw Error(`${a.checkout??process.cwd()} is not a registered checkout (adopt_checkout links it)`);w={project:D.checkout.projectId},k=D.root,y=u(D.root,t),U=D.checkout.projectName??""}let T=a.plan??((l,i,e)=>j(l,i,e)),I=await T(w,a.items,t),J=await d(1e4),A=()=>_(a.items,I,w,U),M=async()=>{I=await T(w,a.items,t)},z=ae(32).toString("base64url"),ie=`/s/${z}`,ee=0,be=null,Se=new Promise((l)=>be=l),ue,ve=a.idleMs??1800000,ce=(l)=>{clearTimeout(ue),setTimeout(()=>{re.close(),re.closeAllConnections?.(),be?.(l)},300)},we=()=>{clearTimeout(ue),ue=setTimeout(()=>{r({event:"aborted",reason:`no activity for ${Math.round(ve/60000)} minutes`}),ce(1)},ve)},te=(l,i)=>{let e=A().find((x)=>x.id===l),B=e?.spec.steps.find((x)=>x.id===i);if(!e||!B)throw new L(404,"no such step");return{flow:e,step:B}},me=async(l,i)=>{let e=i.check;if(e){let B=await v(e,{target:y,checkout:k,flow:l.id,approved:J});if(!B.ok)return r({event:"step_failed",flow:l.id,step:i.id,reason:B.reason}),B}return await O(w,l.id,i.id,i.scope,l.entry.version),r({event:"step_done",flow:l.id,step:i.id,scope:i.scope}),await M(),{ok:!0,reason:e?S(e):"Done."}},$e=()=>{let l=A();return{title:I.items?.length===1?I.items[0].name:`${a.items.length} items`,context:"user"in w?"user":"project",projectName:U,os:C(),items:I.items??[],flows:l.map((i)=>({id:i.id,ref:i.entry.ref,name:i.entry.name,version:i.entry.version,summary:i.spec.summary??"",errors:i.errors,verified:i.verified,approvals:[...i.spec.steps.flatMap((e)=>e.check?[e.check]:[]),...i.spec.verify??[]].filter((e)=>("run"in e)&&!J.has(N(i.id,e))).map(S),params:(i.errors.length?[]:i.entry.spec.params??[]).map((e)=>({...e,value:i.values[e.key]??"",fixed:i.entry.bindings?.[e.key]!==void 0&&!e.editable})),steps:i.steps.map(({step:e,done:B,doneAt:x,doneBy:oe})=>({id:e.id,title:e.title,scope:e.scope,type:e.type,instructions:W(e),done:B,doneAt:x,doneBy:oe,hasCheck:!!e.check,checkLabel:e.check?S(e.check):"",params:e.params??[],rotate:!!e.rotate,prompt:e.type==="claude"?e.prompt:void 0,secret:e.secret?{name:e.secret.name,project:e.secret.project,env:e.secret.env,path:e.secret.path??"/",source:e.secret.source,accept:e.secret.accept,maxBytes:e.secret.maxBytes}:void 0}))}))}},he=async(l,i,e)=>{let{flow:B,step:x}=te(l,i);if(x.type!=="secret"||!x.secret)throw new L(400,"not a secret step");if(!e)return{ok:!1,reason:"empty value"};let oe=await Y(x.secret,e),V=await me(B,{...x,check:{builtin:"infisical.secret-exists",domain:x.secret.domain,project:x.secret.project,env:x.secret.env,path:x.secret.path,name:x.secret.name}});return V.ok?{ok:!0,reason:`${x.secret.name} ${oe} in Infisical.`}:V},je=async(l,i)=>{let e=(m,g,E="application/json")=>{i.writeHead(m,{"content-type":E==="application/json"?"application/json; charset=utf-8":E,"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY",...E.startsWith("text/html")?{"content-security-policy":g.csp}:{}}),i.end(E.startsWith("text/html")?g.html:JSON.stringify(g))},B=l.headers.host??"";if(B!==`127.0.0.1:${ee}`&&B!==`localhost:${ee}`)return e(421,{error:"wrong host"});let x=new URL(l.url??"/",`http://127.0.0.1:${ee}`);if(!x.pathname.startsWith(`${ie}/`)&&x.pathname!==ie)return e(404,{error:"not found"});let oe=x.pathname.slice(3,3+z.length);if(!ke(oe,z))return e(404,{error:"not found"});let V=x.pathname.slice(ie.length).replace(/^\/+/,"");if(we(),l.method==="GET"&&(V===""||V==="index.html")){let m=ae(16).toString("base64"),g=`default-src 'none'; script-src 'nonce-${m}'; style-src 'nonce-${m}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;return e(200,{html:xe(m),csp:g},"text/html; charset=utf-8")}if(l.method==="GET"&&V==="api/plan")return e(200,$e());if(l.method!=="POST")return e(405,{error:"method not allowed"});let ge=l.headers.origin;if(ge!==void 0&&ge!==`http://127.0.0.1:${ee}`&&ge!==`http://localhost:${ee}`)return e(403,{error:"foreign origin"});if(!ke(l.headers["x-costia-wizard"],z))return e(403,{error:"missing wizard header"});let de=await Re(l,Oe);if(V==="api/steps/secret"){let m=x.searchParams.get("flow")??"",g=x.searchParams.get("step")??"",{step:E}=te(m,g);if(E.secret?.source!=="file")throw new L(400,"this step does not take a file");if(de.length>(E.secret.maxBytes??65536))throw new L(413,"the file is too large");return e(200,await he(m,g,de.toString("utf8")))}let Z={};try{Z=de.length?JSON.parse(de.toString("utf8")):{}}catch{throw new L(400,"not JSON")}let q=String(Z.flow??""),ne=String(Z.step??"");switch(V){case"api/steps/check":case"api/steps/done":{let{flow:m,step:g}=te(q,ne);if(g.type==="claude")throw new L(400,"Claude does this step");if(g.type==="input"||g.type==="secret"){if(!g.check)throw new L(400,"fill the step in first")}if(V==="api/steps/check"&&!g.check)throw new L(400,"this step has no check");return e(200,await me(m,g))}case"api/steps/reset":{let{flow:m,step:g}=te(q,ne);return await K(w,m.id,g.id,g.scope),await M(),e(200,{ok:!0,reason:"Marked as not done."})}case"api/steps/input":{let{flow:m,step:g}=te(q,ne);if(g.type!=="input")throw new L(400,"not an input step");let E=Z.values??{},H=new Map;for(let b of g.params??[]){let F=m.entry.spec.params?.find((Ce)=>Ce.key===b);if(!F)continue;if(m.entry.bindings?.[b]!==void 0&&!F.editable)continue;let X=String(E[b]??"").trim(),fe=Fe(m,b,X);if(fe)return e(200,{ok:!1,reason:fe});if(!X)continue;H.set(F.scope,{...H.get(F.scope),[b]:X})}for(let[b,F]of H)await G(w,m.id,b,F);await M();let se=te(q,ne);return e(200,await me(se.flow,se.step))}case"api/steps/secret-text":return e(200,await he(q,ne,String(Z.text??"")));case"api/steps/secret-generate":{let{step:m}=te(q,ne);if(!m.secret)throw new L(400,"not a secret step");return e(200,await he(q,ne,Ne(m.secret)))}case"api/drafts":{let m=A().find((se)=>se.id===q);if(!m)throw new L(404,"no such flow");let g=String(Z.title??"").trim(),E=String(Z.scope??"project");if(!g)throw new L(400,"a step needs a title");if(!P.includes(E))throw new L(400,"bad scope");let H=await Q(m.id,m.entry.spec,{title:g,instructions:String(Z.instructions??"").slice(0,20000),scope:E});return e(200,{ok:!0,message:H})}case"api/verify":{J=await d(1e4);let m=[],g=!0;for(let b of A()){if(b.pending.length||b.errors.length){g=!1,m.push({flow:b.entry.name,label:"steps",ok:!1,reason:b.errors[0]??`${b.pending.length} step(s) left`});continue}let F=await R(b,w,{target:y,checkout:k},J);if(F.results.forEach((X,fe)=>{if(m.push({flow:b.entry.name,label:X.label,ok:X.result.ok,reason:X.result.reason}),!X.result.ok)r({event:"verify_failed",flow:b.id,check:fe,reason:X.result.reason})}),!F.results.length)m.push({flow:b.entry.name,label:"steps",ok:!0,reason:"all done"});g&&=F.ok}if(!g)return e(200,{completed:!1,results:m,message:"Some checks failed; nothing was installed."});await M();let E="";if(D&&k)E=c(await s(k,D.checkout,{approved:J}));else{let b=await p({approved:J});E=b?c([b]):""}let H=a.items.filter((b)=>f(b,I,w,U).ready),se=A().flatMap((b)=>b.claude.map((F)=>({flow:b.id,step:F.id,title:F.title})));return r({event:"completed",applied:H,claudeSteps:se.map(({flow:b,step:F})=>({flow:b,step:F}))}),ce(0),e(200,{completed:!0,results:m,claudeSteps:se,message:H.length?`Installed and checked. ${E.split(`
`)[0]??""}`:"Checked."})}case"api/abort":return r({event:"aborted",reason:"cancelled in the browser"}),ce(1),e(200,{ok:!0});default:return e(404,{error:"not found"})}},re=Me((l,i)=>{je(l,i).catch((e)=>{let B=e instanceof L?e.status:500,x=e instanceof Error?e.message:String(e);if(!i.headersSent)i.writeHead(B,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}),i.end(JSON.stringify({error:x.slice(0,300)}))})});await new Promise((l,i)=>{re.once("error",i),re.listen(0,"127.0.0.1",()=>l())}),ee=re.address().port;let le=`http://127.0.0.1:${ee}${ie}/`;we(),r({event:"listening"}),a.onListening?.(le);let Ie=a.open!==!1&&Be(le);process.stderr.write(Ie?`The setup page is open: ${le}
`:`Open ${le} to continue the setup.
`);let pe=()=>{r({event:"aborted",reason:"interrupted"}),ce(1)};process.once("SIGINT",pe),process.once("SIGTERM",pe);let ze=await Se;return process.off("SIGINT",pe),process.off("SIGTERM",pe),ze}async function ot(a,h){let r=o(a);if(!r)return[];let t=await n(`/v1/checkouts/${r.checkout.checkoutId}/manifest?target=${encodeURIComponent(h)}`);return Object.keys(t.requires??{}).filter((w)=>!f(w,t,{project:r.checkout.projectId},r.checkout.projectName).ready)}export{ot as heldItemsHere,rt as runWizard};
