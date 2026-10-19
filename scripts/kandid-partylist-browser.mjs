// Actual localhost route and browser SDK, synthetic Auth/profile/data only.
// All external requests are intercepted; DNS also blocks Supabase as a backstop.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:5174", api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const profile = mkdtempSync(join(tmpdir(), "kandid-partylist-browser-"));
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const identity = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {}, identities: [] };
const board = { id: 1, auth_user_id: identity.id, role: "electoral_board", status: "active", organization_id: 2, full_name: "Synthetic Board", organizations: { name: "Synthetic Organization" } };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: identity.id, exp: 2100000000, iat: 1700000000, role: "authenticated" })}.${encode("synthetic-signature")}`;
const session = { user: identity, access_token: access, refresh_token: "synthetic-refresh", expires_at: 2100000000, expires_in: 3600, token_type: "bearer" };
const rows = [], mutations = [], exceptions = [], failures = [], browserLogs = [], duplicateAuthWarnings = [], results = [];
let ws, send, denied = false;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, "Fresh isolated browser debugger unavailable");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  const pending = new Map(); let serial = 0;
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
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
      browserLogs.push(message.params.args.map((arg) => arg.value || arg.preview?.properties?.filter((p) => ["message", "code"].includes(p.name)).map((p) => p.value).join(" ") || arg.description).join(" "));
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.args.some((arg) => String(arg.value || "").includes("Multiple GoTrueClient"))) duplicateAuthWarnings.push("Duplicate Auth client");
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const p = message.params, url = new URL(p.request.url), method = p.request.method;
      if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
      if (url.origin !== api) return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
      if (method === "OPTIONS") return fulfill(p.requestId, 204);
      if (url.pathname === "/auth/v1/user") return fulfill(p.requestId, 200, identity);
      if (url.pathname === "/rest/v1/admin_users") return fulfill(p.requestId, 200, [board]);
      if (url.pathname === "/rest/v1/candidates") return fulfill(p.requestId, 200, method === "HEAD" ? undefined : [], [{ name: "Content-Range", value: "*/0" }]);
      if (url.pathname === "/rest/v1/partylists") {
        const matches = rows.filter((row) => ["organization_id", "id"].every((key) => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${row[key]}`));
        if (method === "GET") return fulfill(p.requestId, 200, matches);
        const body = p.request.postData ? JSON.parse(p.request.postData) : null;
        mutations.push({ method, body, query: url.search });
        if (denied) return fulfill(p.requestId, 403, { code: "42501", message: "Synthetic RLS denial" });
        assert.equal(url.searchParams.get("select"), "id");
        if (method === "POST") {
          assert.equal(body.length, 1); assert.equal(body[0].organization_id, 2); assert.equal(Object.hasOwn(body[0], "election_id"), false);
          const row = { ...body[0], id: 700 + mutations.length, election_id: null }; rows.push(row);
          await delay(150); return fulfill(p.requestId, 201, { id: row.id });
        }
        assert.equal(matches.length, 1); assert.equal(url.searchParams.get("organization_id"), "eq.2");
        const row = matches[0];
        if (method === "PATCH") Object.assign(row, body);
        else if (method === "DELETE") rows.splice(rows.indexOf(row), 1);
        else throw new Error("Unexpected Partylist method");
        return fulfill(p.requestId, 200, { id: row.id });
      }
      // Unrelated shell reads receive empty synthetic data. Unexpected writes
      // fail locally and are never forwarded to any real backend.
      if (["GET", "HEAD"].includes(method)) return fulfill(p.requestId, 200, []);
      if (url.pathname.endsWith("/kandid_server_time")) return fulfill(p.requestId, 200, new Date().toISOString());
      failures.push(`${method} ${url.pathname}`);
      return fulfill(p.requestId, 400, { message: "Unexpected synthetic request" });
    })().catch((error) => { failures.push(error.message); });
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('user',${JSON.stringify(JSON.stringify(board))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});` });
  const value = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await value(expression)) return; await delay(100); }
    throw new Error(`Browser condition timed out: ${expression}; diagnostics: ${JSON.stringify({ failures, browserLogs, methods: mutations.map((m) => m.method) })}; text: ${(await value("document.body.innerText")).slice(-900)}`);
  };
  const setName = async (name) => {
    await value(`(()=>{const input=document.querySelector('#partylist-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait("!document.querySelector('.board-partylist-registration .sa-registration-actions .primary-btn').disabled");
  };
  const toReview = async () => {
    await value("document.querySelector('.board-partylist-registration .sa-registration-actions .primary-btn').click()");
    await wait("document.body.textContent.includes('How should students recognize it?')");
    await value("document.querySelector('.board-partylist-registration .sa-registration-actions .primary-btn').click()");
    await wait("!!document.querySelector('.board-partylist-review')");
  };
  const menu = async (text) => {
    await value(`(()=>{const row=document.querySelector('.board-partylist-row');const direct=[...row.querySelectorAll('.board-partylist-action')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(direct.getClientRects().length)direct.click();else{row.querySelector('.board-partylist-menu-trigger').click();}})()`);
    if (await value("!!document.querySelector('.board-partylist-menu-list')")) await value(`[...document.querySelectorAll('.board-partylist-menu-item')].find(b=>b.textContent.trim()===${JSON.stringify(text === "Edit" ? "Edit partylist" : "Delete partylist")}).click()`);
  };
  for (const width of [375, 390, 768, 1024, 1440]) {
    rows.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin + "/board/partylists" });
    await wait("!!document.querySelector('.board-partylists-create:not(:disabled)')");
    await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");
    assert.ok(await value("document.documentElement.scrollWidth<=innerWidth+1"), `${width}px page overflow`);
    const name = `Synthetic Forward ${width}`, edited = `Synthetic Renewed ${width}`, before = mutations.length;
    await value("document.querySelector('.board-partylists-create').click()");
    await wait("!!document.querySelector('#partylist-name')"); await setName(name);
    // Enter submits only the current question; it must never skip Review.
    await value("document.querySelector('.board-partylist-registration form').requestSubmit()");
    await wait("document.body.textContent.includes('How should students recognize it?')");
    assert.equal(mutations.length, before);
    await value("document.querySelector('.board-partylist-registration .sa-registration-actions .primary-btn').click()");
    await wait("!!document.querySelector('.board-partylist-review')");
    const layout = await value("(()=>{const d=document.querySelector('.board-partylist-registration'),b=d.querySelector('button[type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,dialog:d.clientWidth,dialogScroll:d.scrollWidth,buttonVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()");
    assert.ok(layout.dialogScroll <= layout.dialog + 1 && layout.document <= width + 1 && layout.buttonVisible, JSON.stringify(layout));
    await value("(()=>{const b=document.querySelector('.board-partylist-registration button[type=submit]');b.click();b.click();})()");
    await wait(`!document.querySelector('.board-partylist-registration')&&document.body.textContent.includes(${JSON.stringify(name)})`);
    await wait("!!document.querySelector('.board-partylists-create:not(:disabled)')");
    assert.equal(mutations.length, before + 1);
    await value("document.querySelector('.board-partylists-create').click()"); await wait("!!document.querySelector('#partylist-name')");
    await setName(` ${name.toUpperCase()} `); await toReview();
    await value("document.querySelector('.board-partylist-registration button[type=submit]').click()");
    await wait("document.body.textContent.includes('already exists in your organization')");
    await wait("!!document.querySelector('[aria-label=\"Close partylist form\"]:not(:disabled)')");
    assert.equal(mutations.length, before + 1);
    await value("document.querySelector('[aria-label=\"Close partylist form\"]').click()");
    await menu("Edit"); await wait("!!document.querySelector('#partylist-name')"); await setName(edited); await toReview();
    await value("document.querySelector('.board-partylist-registration button[type=submit]').click()");
    await wait(`!document.querySelector('.board-partylist-registration')&&document.body.textContent.includes(${JSON.stringify(edited)})`);
    await wait("!!document.querySelector('.board-partylists-create:not(:disabled)')");
    assert.equal(mutations.at(-1).method, "PATCH");
    await menu("Delete"); await wait("document.body.textContent.includes('Delete Partylist?')");
    await value("[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Delete'&&b.getClientRects().length).at(-1).click()");
    await wait("!document.querySelector('.board-partylist-row')"); assert.equal(mutations.at(-1).method, "DELETE");
    await wait("!!document.querySelector('.board-partylists-create:not(:disabled)')");
    results.push({ width, ...layout, create: "PASS", duplicate: "PASS", edit: "PASS", delete: "PASS", enterPreservesReview: "PASS" });
    console.log(`${width}px wizard, layout, Create, duplicate, Edit and Delete: PASS`);
  }
  denied = true;
  await value("document.querySelector('.board-partylists-create').click()"); await wait("!!document.querySelector('#partylist-name')");
  await setName("Synthetic Denied"); await toReview(); await value("document.querySelector('.board-partylist-registration button[type=submit]').click()");
  await wait("document.body.textContent.includes('You do not have permission to change this partylist')");
  assert.equal(await value("document.querySelector('.board-partylist-review strong').textContent"), "Synthetic Denied");
  assert.deepEqual(exceptions, []); assert.deepEqual(failures, []); assert.deepEqual(duplicateAuthWarnings, []);
  console.log(JSON.stringify({ results, permissionErrorRetainsForm: "PASS", duplicateAuthWarnings: 0, realBackendRequests: 0, productionMutations: 0 }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send?.("Browser.close").catch(() => {}); ws.close(); }
  if (chrome.exitCode === null) chrome.kill();
}
