// Actual localhost Eligibility Rules route with synthetic Auth/data. Every
// backend response is intercepted; Supabase DNS is blocked as a backstop.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:5174", api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const profile = mkdtempSync(join(tmpdir(), "kandid-rule-browser-"));
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const identity = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {}, identities: [] };
const board = { id: 1, auth_user_id: identity.id, role: "electoral_board", status: "active", organization_id: 2, full_name: "Synthetic Board", organizations: { name: "WITSG", membership_scope: "institution" } };
const election = { id: 3, title: "Prac Elec", organization_id: 2, academic_term_id: 1, removed_at: null };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: identity.id, exp: 2100000000, iat: 1700000000, role: "authenticated" })}.${encode("synthetic-signature")}`;
const session = { user: identity, access_token: access, refresh_token: "synthetic-refresh", expires_at: 2100000000, expires_in: 3600, token_type: "bearer" };
const rows = [], mutations = [], exceptions = [], failures = [], duplicateAuthWarnings = [], results = [];
let ws, send, denied = false, ruleReads = 0;
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await delay(100); } }
  assert.ok(port, "Fresh isolated browser debugger unavailable");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0; const pending = new Map();
  send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 20000);
    pending.set(id, { accept, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const fulfill = (id, status, body, extra = []) => send("Fetch.fulfillRequest", {
    requestId: id, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Expose-Headers", value: "Content-Range" },
      { name: "Access-Control-Allow-Headers", value: "authorization,apikey,x-client-info,content-type,accept,accept-profile,content-profile,prefer,range,range-unit,x-retry-count,x-supabase-api-version" },
      { name: "Access-Control-Allow-Methods", value: "GET,HEAD,POST,PATCH,DELETE,OPTIONS" }, ...extra],
    body: Buffer.from(status === 204 || body === undefined ? "" : JSON.stringify(body)).toString("base64"),
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(message.error.message)) : entry.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.args.some((arg) => String(arg.value || "").includes("Multiple GoTrueClient"))) duplicateAuthWarnings.push("Duplicate Auth client");
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const p = message.params, url = new URL(p.request.url), method = p.request.method;
      if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
      if (url.origin !== api) return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
      if (method === "OPTIONS") return fulfill(p.requestId, 204);
      if (url.pathname === "/auth/v1/user") return fulfill(p.requestId, 200, identity);
      if (url.pathname === "/rest/v1/admin_users") return fulfill(p.requestId, 200, [board]);
      if (url.pathname === "/rest/v1/programs") return fulfill(p.requestId, 200, [{ code: "BSIT", name: "Information Technology" }, { code: "BSCS", name: "Computer Science" }]);
      if (url.pathname === "/rest/v1/elections") return fulfill(p.requestId, 200, [election]);
      if (url.pathname === "/rest/v1/academic_terms") return fulfill(p.requestId, 200, [{ id: 1 }]);
      if (url.pathname === "/rest/v1/election_access_tokens") return fulfill(p.requestId, 200, method === "HEAD" ? undefined : [], [{ name: "Content-Range", value: "*/0" }]);
      if (url.pathname === "/functions/v1/vote-access") {
        const body = JSON.parse(p.request.postData); assert.equal(body.action, "vote_dependency_count");
        return fulfill(p.requestId, 200, { data: { count: 0 } });
      }
      if (url.pathname === "/rest/v1/eligibility_rules") {
        const matches = rows.filter((row) => !url.searchParams.has("id") || url.searchParams.get("id") === `eq.${row.id}`);
        if (method === "GET") { ruleReads++; return fulfill(p.requestId, 200, matches.map((row) => ({ ...row, elections: { title: election.title } }))); }
        const body = p.request.postData ? JSON.parse(p.request.postData) : null;
        mutations.push({ method, body, query: url.search });
        if (denied) return fulfill(p.requestId, 403, { code: "42501", message: "Synthetic RLS denial" });
        assert.equal(url.searchParams.get("select"), "id");
        if (method === "POST") {
          assert.deepEqual(body, [{ program: "BSIT", min_year_level: 1, max_year_level: 4, allow_shs: false, election_id: 3 }]);
          const row = { ...body[0], id: 700 + mutations.length }; rows.push(row);
          await delay(150); return fulfill(p.requestId, 201, { id: row.id });
        }
        assert.equal(matches.length, 1); assert.equal(url.searchParams.get("election_id"), "eq.3");
        const row = matches[0];
        if (method === "PATCH") { assert.equal(Object.hasOwn(body, "election_id"), false); Object.assign(row, body); }
        else if (method === "DELETE") rows.splice(rows.indexOf(row), 1);
        else throw new Error("Unexpected rule method");
        return fulfill(p.requestId, 200, { id: row.id });
      }
      if (["GET", "HEAD"].includes(method)) return fulfill(p.requestId, 200, []);
      if (url.pathname.endsWith("/kandid_server_time")) return fulfill(p.requestId, 200, new Date().toISOString());
      failures.push(`${method} ${url.pathname}`); return fulfill(p.requestId, 400, { message: "Unexpected synthetic request" });
    })().catch((error) => failures.push(error.message));
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('user',${JSON.stringify(JSON.stringify(board))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});` });
  const value = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let n = 0; n < 100; n++) { if (await value(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}; ${JSON.stringify(failures)}; text: ${(await value("document.body.innerText")).slice(-1200)}`);
  };
  const input = async (id, content) => {
    await value(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(content))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    await delay(40);
  };
  const continueStep = () => value("document.querySelector('.board-eligibility-registration .sa-registration-actions .primary-btn').click()");
  const ready = () => wait("!!document.querySelector('.board-eligibility-create:not(:disabled)')");
  const open = async () => { await ready(); await value("document.querySelector('.board-eligibility-create').click()"); await wait("!!document.querySelector('#rule-election')"); await input("rule-election", 3); await continueStep(); await wait("!!document.querySelector('#rule-program')"); };
  const fill = async (min = 1, max = 4) => { await input("rule-program", "BSIT"); await input("rule-year-from", min); await input("rule-year-to", max); };
  const review = async () => { await continueStep(); await wait("!!document.querySelector('.board-eligibility-registration .sa-registration-review')"); };
  const save = () => value("document.querySelector('.board-eligibility-registration button[type=submit]').click()");
  const close = async () => { await wait("!!document.querySelector('[aria-label=\"Close eligibility rule form\"]:not(:disabled)')"); await value("document.querySelector('[aria-label=\"Close eligibility rule form\"]').click()"); };
  const action = async (name) => {
    await value(`(()=>{const r=document.querySelector('.board-eligibility-item');const b=[...r.querySelectorAll('.board-eligibility-action')].find(b=>b.textContent.trim()===${JSON.stringify(name)});if(b.getClientRects().length)b.click();else r.querySelector('.board-eligibility-menu-trigger').click();})()`);
    if (await value("!!document.querySelector('.board-eligibility-menu-list')")) await value(`[...document.querySelectorAll('.board-eligibility-menu-item')].find(b=>b.textContent.trim()===${JSON.stringify(name === "Edit" ? "Edit rule" : "Delete rule")}).click()`);
  };
  for (const width of [375,390,768,1440]) {
    rows.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin + "/board/eligibility-rules" }); await ready();
    await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");
    assert.ok(await value("document.documentElement.scrollWidth<=innerWidth+1"), `${width}px page overflow`);
    const before = mutations.length;
    await open(); await fill(4,1);
    assert.equal(await value("document.querySelector('.board-eligibility-registration .sa-registration-actions .primary-btn').disabled"), true);
    await fill(); await review();
    assert.ok(await value("document.querySelector('.board-eligibility-registration').textContent.includes('does not')"));
    const layout = await value("(()=>{const d=document.querySelector('.board-eligibility-registration'),b=d.querySelector('button[type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,dialog:d.clientWidth,scroll:d.scrollWidth,buttonVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()");
    assert.ok(layout.document <= width + 1 && layout.scroll <= layout.dialog + 1 && layout.buttonVisible, JSON.stringify(layout));
    await value("(()=>{const b=document.querySelector('.board-eligibility-registration button[type=submit]');b.click();b.click();})()");
    await wait("!document.querySelector('.board-eligibility-registration')&&!!document.querySelector('.board-eligibility-item')"); await ready();
    assert.equal(mutations.length, before + 1);
    const reads = ruleReads;
    await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Refresh').click()");
    await wait("![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Refresh').disabled");
    assert.ok(ruleReads > reads);
    await open(); await fill(); await review(); await save(); await wait("document.body.textContent.includes('already exists for the election')");
    assert.equal(mutations.length, before + 1); await close();
    await open(); await fill(4,6); await review(); await save(); await wait("document.body.textContent.includes('overlaps another rule')");
    assert.equal(mutations.length, before + 1); await close();
    await action("Edit"); await wait("!!document.querySelector('#rule-election')");
    assert.equal(await value("document.querySelector('#rule-election').disabled"), true);
    await continueStep(); await wait("!!document.querySelector('#rule-program')");
    await value("[...document.querySelectorAll('input[name=\"rule-allow-shs\"]')].at(-1).click()"); await review(); await save();
    await wait("!document.querySelector('.board-eligibility-registration')"); await ready();
    assert.equal(mutations.at(-1).method, "PATCH"); assert.equal(mutations.at(-1).body.allow_shs, true);
    await action("Delete"); await wait("document.body.textContent.includes('Delete Eligibility Rule?')");
    await value("[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Delete Rule'&&b.getClientRects().length).at(-1).click()");
    await wait("!document.querySelector('.board-eligibility-item')"); await ready();
    assert.equal(mutations.at(-1).method, "DELETE");
    results.push({ width, ...layout, create: "PASS", refresh: "PASS", invalidRange: "PASS", duplicate: "PASS", overlap: "PASS", editSHS: "PASS", delete: "PASS" });
    console.log(`${width}px CRUD, Refresh, invalid/overlapping rules, SHS and layout: PASS`);
  }
  denied = true; await open(); await fill(); await review(); await save();
  await wait("document.body.textContent.includes('You do not have permission to change this election')");
  assert.ok(await value("!!document.querySelector('.board-eligibility-registration .sa-registration-review')"));
  assert.deepEqual(exceptions, []); assert.deepEqual(failures, []); assert.deepEqual(duplicateAuthWarnings, []);
  console.log(JSON.stringify({ results, permissionErrorRetainsForm: "PASS", realBackendRequests: 0, productionMutations: 0 }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send?.("Browser.close").catch(() => {}); ws.close(); }
  if (chrome.exitCode === null) chrome.kill();
}
