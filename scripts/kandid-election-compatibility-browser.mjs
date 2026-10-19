// Real Chrome interactions with a synthetic authenticated Board session.
// Fetch interception and DNS blocking prevent every external request from leaving
// Chrome. All election data is synthetic; this never uses a production session.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ELECTION_DELETE_DEPENDENCIES } from "../src/utils/electionDeleteReview.js";

const origin = "http://localhost:5189";
assert.equal((await fetch(`${origin}/board/elections`)).status, 200);
const output = resolve(import.meta.dirname, "../deploy/election-schema-compatibility/evidence");
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "kandid-election-delete-browser-"));
const chrome = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-allow-origins=*",
  "--host-resolver-rules=MAP localhost 127.0.0.1,MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let ws, send;
const journeys = [], externalWrites = [], exceptions = [], localFailures = [], interceptionFailures = [], readPaths = [], blockedOrigins = [];
let mode = "success";
let portal = "board";
const electionQueries = [];
try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; }
    catch { await delay(100); }
  }
  assert.ok(port, "isolated Chrome debugger must be available");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  ws.onclose = event => {
    for (const [id, item] of pending) item.reject(new Error(`Chrome debugger disconnected (code=${event.code}, reason=${event.reason || "none"}, pending=${id})`));
    pending.clear();
  };
  send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial; pending.set(id, { accept, reject }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`Browser command timed out: ${method}`)); }, 15000).unref();
  });
  const fulfill = (requestId, status, body) => send("Fetch.fulfillRequest", {
    requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Allow-Headers", value: "authorization,apikey,x-client-info,content-type,x-supabase-api-version,x-retry-count,accept-profile,content-profile,prefer,range" },
      { name: "Access-Control-Allow-Methods", value: "POST,GET,OPTIONS" },
    ], body: Buffer.from(status === 204 ? "" : JSON.stringify(body)).toString("base64"),
  });
  const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "synthetic-board@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: {}, user_metadata: {} };
  const board = { id: 1, auth_user_id: authUser.id, full_name: "Synthetic Board", role: "electoral_board", status: "active", organization_id: 10, organizations: { id: 10, name: "Synthetic Organization", membership_scope: "institution" } };
  const elections = [1, 2].map(id => ({ id, title: id === 1 ? "Synthetic One" : "Synthetic Two", organization_id: 10,
    academic_term_id: 1, status: "active", campaign_start: "2026-10-10T08:00:00", campaign_end: "2026-10-11T08:00:00",
    start_date: "2026-10-12T08:00:00", end_date: "2026-10-12T12:00:00", student_result_visibility: "after_close",
    voting_access_mode: "anywhere", created_at: "2026-10-01T00:00:00Z", electorate_frozen_at: "2026-10-11T00:00:00Z" }));
  const summary = id => {
    const counts = Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({ key }) => [key, 0]));
    if (mode !== "empty") Object.assign(counts, { positions: 1, candidates: 1, frozen_electorate: 1, votes: id === 2 ? 1 : 0, ballot_records: id === 2 ? 1 : 0, audit_references: 2 });
    if (mode === "partial") delete counts.ballot_records;
    return { schema_version: 1, election_id: id, counts, protected_history: mode !== "empty", may_delete: mode === "empty" };
  };
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      message.error ? item.reject(new Error(message.error.message)) : item.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Network.responseReceived") {
      const r = message.params.response;
      if (r.url.startsWith(origin) && r.status >= 400) localFailures.push({ path: new URL(r.url).pathname, status: r.status });
    }
    if (message.method === "Fetch.requestPaused") void (async () => {
      const p = message.params, url = new URL(p.request.url), method = p.request.method;
      if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
      if (url.origin !== "https://fszgdxqxonqqcrzsnkca.supabase.co") {
        blockedOrigins.push(url.origin);
        return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
      }
      readPaths.push(url.pathname);
      if (method === "OPTIONS") return fulfill(p.requestId, 204, null);
      const body = p.request.postData ? JSON.parse(p.request.postData) : {};
      if (url.pathname === "/auth/v1/user" && method === "GET") return fulfill(p.requestId, 200, authUser);
      if (url.pathname.endsWith("/vote-access") && body.action === "election_dependency_summary") {
        assert.deepEqual(Object.keys(body).sort(), ["action", "election_id"]);
        assert.ok(p.request.headers.Authorization || p.request.headers.authorization, "request carries synthetic authenticated session");
        if (mode === "failure") return fulfill(p.requestId, 503, { error: "Synthetic service unavailable" });
        const result = summary(body.election_id);
        if (mode === "slow") await delay(450);
        return fulfill(p.requestId, 200, { data: result });
      }
      if (url.pathname.endsWith("/rpc/kandid_server_time")) return fulfill(p.requestId, 200, new Date().toISOString());
      if (url.pathname.endsWith("/vote-access") && ["board_vote_rows", "board_dashboard_counts"].includes(body.action)) return fulfill(p.requestId, 200, { data: { votes: [], counts: [] } });
      if (url.pathname.endsWith("/admin-user-management") && body.action === "list") return fulfill(p.requestId, 200, { data: [] });
      if (method === "HEAD" && ["/rest/v1/students", "/rest/v1/elections"].includes(url.pathname)) return fulfill(p.requestId, 200, null);
      if (method === "GET" && url.pathname === "/rest/v1/admin_users") return fulfill(p.requestId, 200, portal === "board" ? board : { ...board, role:"super_admin", organization_id:null });
      if (method === "GET" && url.pathname === "/rest/v1/elections") {
        electionQueries.push(url.search);
        assert.ok(!url.search.includes("removed_at"), "OFF query must not reference missing production column");
        if (mode === "load_failure") return fulfill(p.requestId, 503, {message:"Synthetic register unavailable"});
        return fulfill(p.requestId, 200, mode === "zero" ? [] : elections);
      }
      if (method === "GET" && url.pathname.startsWith("/rest/v1/")) return fulfill(p.requestId, 200, []);
      externalWrites.push({ method, path: url.pathname, action: body.action || null });
      return fulfill(p.requestId, 403, { error: "No production request is permitted by this browser test." });
    })().catch(error => interceptionFailures.push(error.message));
  };
  await send("Browser.getVersion"); await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: authUser.id, role: "authenticated", aud: "authenticated", exp: expires })}.synthetic-only`, refresh_token: "synthetic-only", expires_at: expires, expires_in: 86400, token_type: "bearer", user: authUser };
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('user',JSON.stringify(location.pathname.startsWith('/super-admin/')?{...${JSON.stringify(board)},role:'super_admin',organization_id:null}:${JSON.stringify(board)}));localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});}` });
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await delay(60); }
    console.error(JSON.stringify({ browser: await evaluate(`({path:location.pathname,text:document.body.innerText.slice(0,1600)})`), exceptions, localFailures, externalWrites, interceptionFailures, readPaths, blockedOrigins }));
    throw new Error(`Browser condition failed: ${expression}`);
  };
  const click = async selector => {
    const rect = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b) return null;b.scrollIntoView({block:'nearest',behavior:'instant'});const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,hit:hit===b||b.contains(hit),hitClass:hit?.className,viewport:innerHeight,targetHeight:r.height}})()`);
    assert.ok(rect, `click target ${selector}`);
    if (!rect.hit) {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(output, "obscured-control.png"), Buffer.from(shot.data, "base64"));
      throw new Error(`Obscured click target ${selector}: ${JSON.stringify(rect)}`);
    }
    const { x, y } = rect;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await delay(60);
  };
  const key = async (key, code, modifiers = 0) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  };
  for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 820, 1000], ["mobile", 375, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    portal = "board";
    mode = "success";
    await send("Page.navigate", { url: `${origin}/board/elections` });
    await wait(`document.querySelectorAll('.board-election-record').length===2`);
    await delay(2200);
    if (await evaluate(`!!document.querySelector('[aria-label="Dismiss install prompt"]')`)) await click('[aria-label="Dismiss install prompt"]');
    assert.equal(await evaluate(`document.querySelector('.board-elections-snapshot-total dd').textContent`), "2");
    assert.equal(await evaluate(`document.body.textContent.includes('Removed Elections')`), false);
    const layout = await evaluate(`(()=>{const h=document.querySelector('.board-elections-baseline');const t=h.querySelector('h1').getBoundingClientRect();const a=h.querySelector('.board-elections-create').getBoundingClientRect();return {noOverlap:a.left>=t.right||a.top>=t.bottom||t.left>=a.right||t.top>=a.bottom,noOverflow:document.documentElement.scrollWidth<=innerWidth+1,headerNoOverflow:h.scrollWidth<=h.clientWidth+1}})()`);
    assert.ok(layout.noOverlap, `${name}: title and buttons must not overlap`);
    assert.ok(layout.noOverflow && layout.headerNoOverflow, `${name}: no horizontal overflow ${JSON.stringify(layout)}`);
    const registerShot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, `${name}-register.png`), Buffer.from(registerShot.data, "base64"));
    await click('[aria-label="Manage election Synthetic One"]');
    await wait(`!!document.querySelector('[aria-label="Close manage setup"]')`);
    await click('[aria-label="Close manage setup"]');
    await click('[aria-label="Delete election Synthetic Two"]');
    await wait(`!!document.querySelector('.board-election-danger-primary')`);
    await click('.board-election-danger-primary');
    await wait(`document.querySelectorAll('.board-election-dependency-detail li').length===19`);
    assert.equal(await evaluate(`!!document.querySelector('.board-election-danger-button')`), false);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, `${name}-review.png`), Buffer.from(screenshot.data, "base64"));
    await key("Escape", "Escape");
    await wait(`!document.querySelector('[role="dialog"]')`);
    journeys.push(`${name} ${width}px: two elections, count 2, no removed controls/overlap/overflow, Manage, Review Related expands, close`);

    mode = "failure";
    await click('[aria-label="Delete election Synthetic One"]');
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Related records unavailable')`);
    mode = "success";
    await click('.board-election-danger-primary');
    await wait(`!!document.querySelector('[aria-expanded="false"]')`);
    await click('[aria-label="Close election removal"]');
    await wait(`!document.querySelector('[role="dialog"]')`);
    mode = "slow";
    await click('[aria-label="Delete election Synthetic One"]');
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Checking related records')`);
    await click('[aria-label="Close election removal"]');
    await delay(700);
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
    journeys.push(`${name}: dependency failure Retry, close pending review stays closed`);

    portal = "super_admin";
    mode = "success";
    await send("Page.navigate", { url: `${origin}/super-admin/elections` });
    await wait(`document.querySelectorAll('.sa-election-record').length===2`);
    assert.equal(await evaluate(`document.body.textContent.includes('Removed Elections')`), false);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), true);
    journeys.push(`${name}: Super Admin register loads both records, removal inactive, no overflow`);
  }
  portal = "board";
  mode = "load_failure";
  await send("Page.navigate", { url: `${origin}/board/elections` });
  await wait(`!!document.querySelector('.board-elections-state.is-error')`);
  assert.equal(await evaluate(`document.querySelector('.board-elections-snapshot-total dd').textContent`), "Unavailable");
  assert.equal(await evaluate(`document.body.textContent.includes('Empty register')`), false);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), true);
  mode = "success";
  await click('.board-elections-state-action');
  await wait(`document.querySelectorAll('.board-election-record').length===2`);
  journeys.push("Actual list failure is Unavailable, not zero; Retry restores both rows");
  mode = "zero";
  await send("Page.navigate", { url: `${origin}/board/elections` });
  await wait(`document.body.textContent.includes('Empty register')`);
  assert.equal(await evaluate(`document.querySelector('.board-elections-snapshot-total dd').textContent`), "0");
  journeys.push("Genuine successful empty response remains an empty register");
  assert.deepEqual(externalWrites, []);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(localFailures, []);
  assert.deepEqual(interceptionFailures, []);
  assert.ok(electionQueries.length >= 6);
  assert.equal(readPaths.some(path => path.endsWith('/manage-election-removal')), false);
  writeFileSync(join(output, "browser-results.json"), JSON.stringify({ journeys, viewportWidths: [1440,820,375], syntheticAuthenticatedSession:true, allExternalTrafficIntercepted:true, productionTraffic:0, electionQueries, exceptions, localFailures, externalWrites }, null, 2));
  console.log(JSON.stringify({ passed:journeys.length, failed:0, viewportWidths:[1440,820,375], productionTraffic:0 }));
} catch (error) {
  console.error(error.stack || error);
  writeFileSync(join(output,"browser-failure.json"), JSON.stringify({error:error.message,journeys,exceptions,localFailures,interceptionFailures,readPaths},null,2));
  process.exitCode=1;
} finally {
  if(send) await Promise.race([send("Browser.close").catch(()=>{}),delay(500)]);
  ws?.close();
  if(chrome.exitCode===null) chrome.kill();
}
