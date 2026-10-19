// Fresh isolated browser; synthetic sessions and intercepted backend responses.
// All external requests are intercepted before transmission; DNS also blocks Supabase.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:5174";
const api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const profile = mkdtempSync(resolve(import.meta.dirname, "../..", ".student-election-browser-"));
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let ws, send;
const results = [], exceptions = [], localFailures = [], requests = [];
let mode = "campaign", initId;
const election = { id: 3, title: "Synthetic Prac Elec", status: "active", organization_id: 1, campaign_start: "2026-10-18T16:46:00", campaign_end: "2026-10-20T08:00:00", start_date: "2026-10-20T10:00:00", end_date: "2026-10-20T20:00:00", student_result_visibility: "hidden", results_released_at: null, voting_access_mode: "anywhere", organizations: { id: 1, name: "WITSG", membership_scope: "institution" } };
const student = { id: 42, student_number: "9090909090", first_name: "Synthetic", last_name: "Student", status: "active", role: "student", program: "BSIT", year_level: 4 };
const user = { id: "00000000-0000-4000-8000-000000000042", aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-10-17T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [] };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...user, sub: user.id, exp: 2100000000, iat: 1700000000 })}.${encode("synthetic-signature")}`;
const session = { user, access_token: token, refresh_token: "synthetic-refresh", expires_at: 2100000000, expires_in: 3600, token_type: "bearer" };
const published = { status: "AVAILABLE", data: { election: { id: 3, title: election.title, campaign_start: election.campaign_start, campaign_end: election.campaign_end }, organization: election.organizations, positions: [{ id: 1, name: "President" }], candidates: [1, 2].map(id => ({ id, position_id: 1, display_name: `Published Candidate ${id}`, platform: `Synthetic platform ${id}`, bio: "Synthetic biography", credentials: "Synthetic credentials", campaign_materials: [{ type: "document", title: "Platform PDF", url: "storage://campaign-materials/1/3/00000000-0000-4000-8000-000000000001.pdf" }] })) } };

try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await delay(100); } }
  assert.ok(port, "Fresh isolated Chrome debugger unavailable");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial; pending.set(id, { accept, reject, method }); ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Browser command timeout: ${method}`)); }, 15000);
    pending.get(id).timer = timer;
  });
  const fulfill = (id, status, body) => send("Fetch.fulfillRequest", { requestId: id, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin }, { name: "Access-Control-Allow-Headers", value: "authorization,apikey,x-client-info,content-type,x-supabase-api-version,x-retry-count,accept-profile,content-profile,prefer,range" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }], body: Buffer.from(status === 204 ? "" : JSON.stringify(body)).toString("base64") });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(`${entry.method}: ${message.error.message}`)) : entry.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Network.responseReceived" && message.params.response.url.startsWith(origin) && message.params.response.status >= 400) localFailures.push(message.params.response.status);
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const p = message.params, url = new URL(p.request.url);
      if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
      if (url.origin !== api) return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
      if (p.request.method === "OPTIONS") return fulfill(p.requestId, 204, null);
      const body = p.request.postData ? JSON.parse(p.request.postData) : {};
      requests.push({ path: url.pathname, action: body.action });
      if (url.pathname === "/auth/v1/user") return fulfill(p.requestId, 200, user);
      if (url.pathname.endsWith("/student-profile")) {
        if (body.action === "profile") return fulfill(p.requestId, 200, { data: student });
        assert.deepEqual(body, { action: "organization_memberships" });
        if (mode === "memberships-error") return fulfill(p.requestId, 503, { error: "Synthetic unavailable memberships" });
        const memberships = mode === "no-memberships" ? [] : [{ organization_id: 1, academic_term_id: 1, membership_status: "active", organization: election.organizations }];
        return fulfill(p.requestId, 200, { data: { student_id: 42, academic_term: { id: 1, status: "active" }, enrollment: { academic_term_id: 1, enrollment_status: "enrolled" }, count: memberships.length, memberships } });
      }
      if (url.pathname.endsWith("/student-notifications")) return fulfill(p.requestId, 200, { data: { notifications: [] } });
      if (url.pathname.endsWith("/vote-access")) {
        assert.ok(["student_voted_elections", "student_has_voted"].includes(body.action));
        if (mode === "history-error") return fulfill(p.requestId, 503, { error: "Synthetic voting history unavailable" });
        return fulfill(p.requestId, 200, { data: body.action === "student_has_voted" ? { has_voted: mode === "voted" } : { election_ids: mode === "voted" ? [3] : [] } });
      }
      if (url.pathname.endsWith("/kandid_get_student_published_campaign")) {
        assert.deepEqual(body, { p_election_id: 3 });
        if (mode === "expired") return fulfill(p.requestId, 401, { code: "PGRST301", message: "JWT expired" });
        if (mode === "server-error") return fulfill(p.requestId, 503, { message: "Synthetic service unavailable" });
        if (mode === "ineligible") return fulfill(p.requestId, 200, { status: "UNAVAILABLE", reason: "ELECTION_NOT_AVAILABLE", data: null });
        if (mode === "upcoming") return fulfill(p.requestId, 200, { status: "UNAVAILABLE", reason: "CAMPAIGN_NOT_STARTED", data: null });
        if (["waiting", "voting", "ballot-denied", "voted", "closed"].includes(mode)) return fulfill(p.requestId, 200, { status: "UNAVAILABLE", reason: "CAMPAIGN_ENDED", data: null });
        if (mode === "empty") return fulfill(p.requestId, 200, { ...published, status: "EMPTY", data: { ...published.data, candidates: [] } });
        return fulfill(p.requestId, 200, published);
      }
      if (url.pathname.endsWith("/kandid_get_student_ballot_candidates")) return mode === "ballot-denied" ? fulfill(p.requestId, 403, { code: "42501", message: "Synthetic electorate denial" }) : fulfill(p.requestId, 200, [{ id: 1 }]);
      if (url.pathname.startsWith("/storage/v1/object/sign/")) return fulfill(p.requestId, 200, { signedURL: "/object/sign/campaign-materials/synthetic.pdf?token=synthetic-only" });
      if (url.pathname === "/rest/v1/elections") return fulfill(p.requestId, 200, url.searchParams.get("id") === "eq.3" ? election : [election]);
      if (url.pathname === "/rest/v1/positions") return fulfill(p.requestId, 200, [{ id: 1, election_id: 3, name: "President", display_order: 1, max_votes: 1, status: "active" }]);
      if (url.pathname.startsWith("/rest/v1/")) return fulfill(p.requestId, 200, []);
      throw new Error(`Unexpected backend path: ${url.pathname}`);
    })().catch(error => { if (!/Invalid InterceptionId/.test(error.message)) exceptions.push(error.message); });
  };
  const value = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Browser expression failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 100; n++) { if (await value(`!!document.body && (${expression})`)) return; await delay(100); }
    throw new Error(`UI state missing (${mode}): ${await value("document.body.textContent.slice(-1800)")}`);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  for (const width of [375, 820, 1440]) {
    for (const scenario of ["campaign", "upcoming", "waiting", "voting", "ballot-denied", "voted", "closed", "empty", "ineligible", "expired", "server-error", "memberships-error", "no-memberships", "history-error"]) {
      mode = scenario; requests.length = 0;
      const now = mode === "upcoming" ? "2026-10-18T08:00:00+08:00" : mode === "waiting" ? "2026-10-20T09:00:00+08:00" : ["voting", "ballot-denied", "voted"].includes(mode) ? "2026-10-20T11:00:00+08:00" : mode === "closed" ? "2026-10-20T21:00:00+08:00" : "2026-10-19T20:00:00+08:00";
      await send("Page.navigate", { url: "about:blank" });
      await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
      if (initId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: initId });
      initId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('user',${JSON.stringify(JSON.stringify(student))});const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]))}static now(){return new NativeDate(${JSON.stringify(now)}).getTime()}}}` })).identifier;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      const listing = ["memberships-error", "no-memberships", "history-error"].includes(mode);
      await send("Page.navigate", { url: origin + (listing ? "/student/elections" : "/student/elections/3/campaign") });
      const expected = { campaign: "Published Candidate 2", upcoming: "Campaign isn't open yet.", waiting: "Waiting for Voting", voting: "Cast Your Vote", "ballot-denied": "not available to this student account", voted: "Ballot submitted", closed: "Voting Closed", empty: "No published campaigns yet.", ineligible: "you may not be eligible", expired: "Your session needs attention.", "server-error": "We couldn't load the campaign right now.", "memberships-error": "Unable to load elections.", "no-memberships": "No elections available for your account.", "history-error": "Synthetic Prac Elec" }[mode];
      await wait(`document.body.textContent.includes(${JSON.stringify(expected)})`);
      assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true, `${width}px ${mode} overflow`);
      if (!listing) assert.ok(requests.some(request => request.path.endsWith("kandid_get_student_published_campaign")), "RPC must reach the network interception");
      if (mode === "campaign") {
        assert.equal(await value("document.querySelectorAll('.student-campaign-candidate').length"), 2);
        await value("document.querySelector('.student-campaign-candidate button').click()");
        await wait("document.body.textContent.includes('Synthetic platform 1') && !!document.querySelector('.student-campaign-materials a')");
        assert.ok(requests.some(request => request.path.startsWith("/storage/v1/object/sign/")));
        assert.equal(await value("document.body.textContent.includes('Cast Your Vote')"), false);
        await send("Page.reload"); await wait("document.body.textContent.includes('Published Candidate 2')");
        await value("document.querySelector('.student-campaign-back').click()");
        await wait("document.body.textContent.includes('Campaign Ongoing') && document.body.textContent.includes('View Campaign')");
      }
      if (mode === "voting") {
        await value("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Cast Your Vote')).click()");
        await wait("location.pathname === '/student/vote/3' && document.body.textContent.includes('President')");
      }
      if (["expired", "ineligible", "ballot-denied", "server-error", "empty"].includes(mode)) assert.equal(await value("document.body.textContent.includes('Published Candidate 1')"), false);
      if (mode === "server-error") {
        mode = "campaign";
        await value("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Retry')).click()");
        await wait("document.body.textContent.includes('Published Candidate 2')");
      }
      results.push({ width, scenario, status: "PASS" });
      console.log(`${width}px ${scenario}: PASS`);
    }
  }
  assert.deepEqual(exceptions, []); assert.deepEqual(localFailures, []);
  const report = { results, realBackendRequests: 0, productionMutations: 0, exceptions, localFailures };
  mkdirSync("deploy/student-election-journey-review", { recursive: true });
  writeFileSync("deploy/student-election-journey-review/browser-results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  mkdirSync("deploy/student-election-journey-review", { recursive: true });
  writeFileSync("deploy/student-election-journey-review/browser-results.json", JSON.stringify({ status: "BLOCKED", completed: results, error: error.message, realBackendRequests: 0, productionMutations: 0 }, null, 2));
  throw error;
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send?.("Browser.close").catch(() => {}); ws.close(); }
  if (chrome.exitCode === null) chrome.kill();
}
