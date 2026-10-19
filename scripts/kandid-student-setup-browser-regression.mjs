// Real Chrome UI regression with synthetic Auth/Function responses. Fetch
// interception blocks all external traffic BEFORE transmission. No real email,
// Supabase account, Student record or production credential is used for testing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:5174";
const organizationNotificationsOnly = process.argv.includes("--organization-notifications-only");
const profile = mkdtempSync(resolve(import.meta.dirname, "../..", ".student-setup-regression-"));
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let ws, closeBrowser;
const results = [];
try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, "Isolated Chrome debugger available");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0, mode = "success";
  const pending = new Map(), requests = [], exceptions = [], localFailures = [], unexpectedBackends = [], networkFailures = [];
  let cancelledInterceptions = 0;
  const syntheticPassword = "SyntheticSetup!123";
  const student = { id: 42, student_number: "9090909090", status: "active", first_name: "Synthetic", last_name: "Student", email: "synthetic@example.invalid", program: "BSIT", year_level: 1 };
  const dashboardOrganizations = [
    { id: 1, name: "WITSG", description: "Synthetic institution organization", membership_scope: "institution", organization_type: "departmental" },
    { id: 2, name: "PSITS", description: "Synthetic program organization", membership_scope: "program", organization_type: "departmental" },
  ];
  const user = { id: "00000000-0000-4000-8000-000000000042", aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-10-17T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [] };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...user, sub: user.id, exp: expires, iat: expires - 3600 })}.${Buffer.from("synthetic-only-signature").toString("base64url")}`;
  const session = { access_token: token, refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: expires, token_type: "bearer" };
  const send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial; pending.set(id, { accept, reject, method }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error("Browser command timeout: " + method)); }, 15000).unref();
  });
  closeBrowser = () => send("Browser.close");
  const fulfill = (requestId, status, body) => send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin }, { name: "Access-Control-Allow-Headers", value: "authorization, apikey, x-client-info, content-type, x-supabase-api-version, x-retry-count, accept-profile, content-profile, prefer, range" }, { name: "Access-Control-Allow-Methods", value: "POST, GET, OPTIONS" }, { name: "Access-Control-Expose-Headers", value: "Retry-After" }, ...(status === 429 ? [{ name: "Retry-After", value: "900" }] : [])], body: Buffer.from(status === 204 ? "" : JSON.stringify(body)).toString("base64") });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      message.error ? item.reject(new Error(item.method + ": " + message.error.message)) : item.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Network.loadingFailed") networkFailures.push({ error: message.params.errorText, cors: message.params.corsErrorStatus });
    if (message.method === "Network.responseReceived") {
      const r = message.params.response;
      if (r.url.startsWith(origin) && r.status >= 400) localFailures.push({ path: new URL(r.url).pathname, status: r.status });
    }
    if (message.method === "Fetch.requestPaused") {
      void (async () => {
        const p = message.params, url = new URL(p.request.url);
        if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
        if (url.origin !== "https://fszgdxqxonqqcrzsnkca.supabase.co") {
          if (url.hostname.endsWith("supabase.co") || url.hostname === "127.0.0.1") unexpectedBackends.push(url.hostname);
          return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
        }
        if (p.request.method === "OPTIONS") return fulfill(p.requestId, 204, null);
        const body = p.request.postData ? JSON.parse(p.request.postData) : {};
        requests.push({ path: url.pathname, action: body.action, hasEmail: Object.hasOwn(body, "registered_email"), correctPassword: body.password === syntheticPassword });
        if (url.pathname.endsWith("/resolve-student-login")) {
          if (body.action === "inspect_setup") return fulfill(p.requestId, 200, { data: { verification_required: true, student_details: { student_number: student.student_number, details_verified: false } } });
          if (body.action === "login") return mode === "login-rejected" ? fulfill(p.requestId, 401, { data: { authenticated: false } }) : fulfill(p.requestId, 200, { data: { authenticated: true, session } });
          if (body.action === "begin_access") return mode === "request-limited"
            ? fulfill(p.requestId, 429, { data: { verification_requested: false } })
            : fulfill(p.requestId, 202, { data: { verification_requested: true, delivery_confirmed: false, retry_after_seconds: 60 } });
          assert.equal(body.action, "verify_access");
          assert.equal(body.student_number, student.student_number);
          assert.equal(Object.hasOwn(body, "registered_email"), false);
          if (["incorrect", "expired", "reused"].includes(mode)) return fulfill(p.requestId, 401, { data: { authenticated: false } });
          if (mode === "rate-limited") return fulfill(p.requestId, 429, { data: { authenticated: false } });
          return fulfill(p.requestId, 200, { data: { authenticated: true, session, student_details: { ...student, details_verified: true, account_state: mode.startsWith("existing") ? "active" : "pending", enrollments: [{ academic_term_id: 1, program: "BSIT", year_level: 1, enrollment_status: "enrolled" }] } } });
        }
        if (url.pathname === "/auth/v1/user") return fulfill(p.requestId, 200, user);
        if (url.pathname === "/auth/v1/logout") {
          assert.equal(url.searchParams.get("scope"), "local");
          return fulfill(p.requestId, 204, null);
        }
        if (url.pathname.endsWith("/student-profile")) {
          if (body.action === "organization_member_count") {
            assert.deepEqual(Object.keys(body).sort(), ["action", "organization_id"]);
            if (mode === "count-error") return fulfill(p.requestId, 403, { error: "Synthetic member count unavailable" });
            return fulfill(p.requestId, 200, { data: { organization_id: body.organization_id, academic_term: { id: 1, status: "active" }, count: mode === "count-zero" ? 0 : 2 } });
          }
          if (body.action === "organization_memberships") {
            assert.deepEqual(body, { action: "organization_memberships" });
            if (mode === "login-memberships-failure") return fulfill(p.requestId, 503, { error: "Synthetic unavailable memberships" });
            const memberships = mode === "login-memberships-empty" ? [] : dashboardOrganizations.map(organization => ({ organization_id: organization.id, academic_term_id: 1, membership_status: "active", source: "activation", organization }));
            return fulfill(p.requestId, 200, { data: { student_id: student.id, academic_term: { id: 1, academic_year: "2026-2027", semester: "1st Semester", status: "active" }, enrollment: { academic_term_id: 1, enrollment_status: "enrolled", program: "BSIT", year_level: 4 }, memberships, count: mode === "login-memberships-malformed" ? 99 : memberships.length } });
          }
          assert.deepEqual(body, { action: "profile" });
          if (mode === "login-profile-missing") return fulfill(p.requestId, 404, { message: "Synthetic missing profile function" });
          if (mode === "login-profile-forbidden") return fulfill(p.requestId, 403, { error: "Synthetic denied profile" });
          return fulfill(p.requestId, 200, { data: { ...student, role: "student", student_number: mode === "login-wrong-profile" ? "1111111" : student.student_number } });
        }
        if (url.pathname.endsWith("/student-notifications")) {
          assert.deepEqual(body, { action: "list", limit: 20 });
          if (mode === "notifications-error") return fulfill(p.requestId, 403, { error: "Synthetic notification service unavailable" });
          return fulfill(p.requestId, 200, { data: { notifications: mode === "notifications-loaded" ? [{ id: 101, title: "Synthetic membership notice", message: "A synthetic organization notice", metadata: { href: "/student/profile" }, type: "organization_restored", is_read: false, created_at: "2026-10-17T00:00:00Z", read_at: null }] : [] } });
        }
        if (url.pathname === "/rest/v1/organizations") return mode === "login-catalog-failure" ? fulfill(p.requestId, 403, { message: "Synthetic public catalog denial" }) : fulfill(p.requestId, 200, dashboardOrganizations);
        if (url.pathname === "/rest/v1/elections" && url.searchParams.get("organization_id")?.startsWith("eq.")) {
          assert.ok(url.searchParams.getAll("status").includes("neq.draft"));
          assert.ok(url.searchParams.getAll("status").includes("neq.archived"));
          return fulfill(p.requestId, 200, [1, 2, 3].map(id => ({ id, title: `Synthetic election ${id}`, status: "closed", start_date: "2026-10-01", end_date: "2026-10-02" })));
        }
        if (url.pathname.startsWith("/rest/v1/")) return fulfill(p.requestId, 200, []);
        if (url.pathname.endsWith("/vote-access")) return fulfill(p.requestId, 200, { data: { election_ids: [] } });
        if (url.pathname.endsWith("/link-student-identity")) {
          assert.equal(body.student_number, student.student_number);
          assert.equal(body.setup_mode, true);
          assert.equal(body.password, syntheticPassword);
          if (mode === "link-failure") return fulfill(p.requestId, 403, { error: "Synthetic linking denial" });
          const linkedStudent = mode === "wrong-student" ? { ...student, student_number: "different" } : mode === "pending-student" ? { ...student, status: "pending" } : student;
          return fulfill(p.requestId, 200, { linked: true, student: linkedStudent });
        }
        throw new Error("Unexpected backend path in synthetic UI regression");
      })().catch(error => {
        // Chrome cancels outstanding resource interceptions on full reload/
        // navigation. Keep these separate from runtime or fixture failures.
        if (/^Fetch\.(fulfillRequest|continueRequest|failRequest): Invalid InterceptionId\.$/.test(error.message)) cancelledInterceptions += 1;
        else exceptions.push(error.message);
      });
    }
  };
  const value = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("Browser expression failed");
    return r.result?.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 120; n++) { if (await value(expression)) return; await delay(100); }
    console.log(JSON.stringify({ diagnostic: mode, requests, exceptions, localFailures, networkFailures, ui: await value("({path:location.pathname,routeTrace:window.__routeTrace,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),headings:[...document.querySelectorAll('h3')].map(e=>e.textContent),responseDiagnostic:window.__setupResponseDiagnostic})") }));
    throw new Error("Expected UI state did not appear in scenario " + mode);
  };
  const type = async (selector, text) => {
    assert.equal(await value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select();return true})()`), true);
    await send("Input.insertText", { text }); await delay(60);
  };
  const submit = selector => value(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__routeTrace=[];for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=(...args)=>{window.__routeTrace.push({method,path:args[2],stack:new Error().stack.split('\\n').slice(1,7)});return original(...args)}}" });
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  for (const scenario of [
    { name: "desktop success", mode: "success", width: 1280 },
    { name: "mobile success", mode: "success", width: 390 },
    { name: "existing identity goes to login without reset", mode: "existing", width: 390 },
    { name: "existing identity requires explicit verified recovery", mode: "existing-recovery", width: 1280 },
    ...["incorrect", "expired", "reused", "rate-limited", "request-limited", "link-failure", "wrong-student", "pending-student"].map(name => ({ name, mode: name, width: 390 })),
  ].filter(() => !organizationNotificationsOnly)) {
    mode = scenario.mode; requests.length = 0;
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: 900, deviceScaleFactor: 1, mobile: scenario.width < 600 });
    await send("Page.navigate", { url: origin + "/student-setup" });
    await wait("!!document.querySelector('input[autocomplete=username]')");
    await value(`(()=>{const original=window.fetch.bind(window);window.fetch=async (...args)=>{const r=await original(...args);if(String(args[0]).includes('/resolve-student-login')){const body=await r.clone().json();window.__setupResponseDiagnostic={status:r.status,keys:Object.keys(body),authenticated:body.data?.authenticated,tokenPresent:!!body.data?.session?.access_token}}return r}})()`);
    await type("input[autocomplete=username]", student.student_number);
    await submit(".student-setup-lookup button.student-auth-submit");
    await wait("!!document.querySelector('#student-setup-new-password')");
    assert.equal(requests.filter(r => r.action === "inspect_setup").length, 1);
    assert.equal(await value("document.querySelector('.student-setup-identity').textContent.includes('Protected until email verification')"), true);
    assert.equal(await value("document.querySelector('.student-setup-identity').textContent.includes('synthetic@example.invalid')"), false);
    assert.equal(await value("document.querySelector('.student-setup-identity').querySelector('input,select,textarea') === null"), true);
    if (mode === "success") {
      for (let n = 0; n < 8; n++) await submit(".student-setup-activation button.student-auth-submit");
      assert.equal(await value("document.querySelectorAll('.kandid-progressive-field-error').length"), 2);
      assert.equal(await value("[...document.querySelectorAll('.kandid-progressive-field-error')].every(e=>e.textContent.length<80)"), true);
      await type("#student-setup-new-password", "short");
      await type("#student-setup-confirm-password", "different");
      for (let n = 0; n < 8; n++) await submit(".student-setup-activation button.student-auth-submit");
      assert.equal(await value("document.querySelectorAll('.kandid-progressive-field-error').length"), 2);
      assert.equal(await value("[...document.querySelectorAll('.kandid-progressive-field-error')].every(e=>e.textContent.length<160)"), true);
      assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
    }
    await type("#student-setup-new-password", syntheticPassword);
    await type("#student-setup-confirm-password", syntheticPassword);
    await submit(".student-setup-activation button.student-auth-submit");
    if (mode === "request-limited") {
      await wait("document.querySelector('.student-setup-activation button.student-auth-submit').disabled && document.body.textContent.includes('Too many code requests')");
      assert.equal(await value("document.querySelectorAll('[role=alert]').length"), 1);
      assert.equal(await value("document.querySelectorAll('[data-student-otp-index]').length"), 0);
      assert.equal(await value("document.body.textContent.includes('Wait 900s')"), true);
      assert.equal(requests.filter(r => r.action === "begin_access").length, 1);
      results.push({ journey: scenario.name, status: "PASS" });
      continue;
    }
    await wait("document.querySelectorAll('[data-student-otp-index]').length === 6");
    assert.equal(await value("document.body.textContent.includes('If no new email arrives')"), true);
    assert.equal(await value("document.body.textContent.includes('has been sent')"), false);
    assert.equal(await value("document.querySelector('input[type=email]') === null"), true);
    assert.equal(await value("document.querySelector('.student-otp-actions button').disabled"), true, "resend cooldown preserved");
    await submit(".student-setup-verify button.student-auth-submit");
    await wait("document.querySelectorAll('[role=alert]').length === 1");
    assert.equal(await value("document.body.textContent.split('Enter all six digits').length - 1"), 1);
    assert.equal(requests.filter(r => r.action === "verify_access").length, 0);
    for (let i = 0; i < 6; i++) await type(`[data-student-otp-index="${i}"]`, "012345"[i]);
    assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await value("(()=>{const button=document.querySelector('.student-setup-verify button.student-auth-submit');button.click();button.click()})()");
    if (mode.startsWith("existing")) {
      await wait("document.body.textContent.includes('Your account is already active.')");
      assert.equal(requests.filter(r => r.path.endsWith('/link-student-identity')).length, 0);
      assert.equal(await value("document.querySelector('.student-setup-identity').textContent.includes('synthetic@example.invalid')"), true);
      if (mode === "existing-recovery") {
        await submit(".student-setup-success .student-auth-setup-link");
        await wait("document.body.textContent.includes('Account Successfully Registered')");
        assert.equal(requests.filter(r => r.path.endsWith('/link-student-identity')).length, 1);
      }
      await submit(".student-setup-success button.student-auth-submit");
      await wait("location.pathname === '/student-login'");
    } else if (mode === "success") {
      await wait("document.body.textContent.includes('Account Successfully Registered')");
      assert.equal(await value("location.pathname"), "/student-setup", "no automatic dashboard redirect");
      assert.equal(await value("document.body.textContent.includes('Your Kandid account is now ready. You can proceed to login.')"), true);
      assert.equal(await value("document.querySelector('input[type=password]') === null"), true);
      assert.equal(await value(`Object.values(localStorage).some(v=>v.includes(${JSON.stringify(syntheticPassword)})) || Object.values(sessionStorage).some(v=>v.includes(${JSON.stringify(syntheticPassword)}))`), false);
      assert.equal(requests.filter(r => r.path.endsWith("/link-student-identity") && r.correctPassword).length, 1);
      assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
      await submit(".student-setup-success button.student-auth-submit");
      await wait("location.pathname === '/student-login'");
    } else {
      await wait("!!document.querySelector('.student-setup-feedback[role=alert]') && !document.querySelector('.student-setup-verify button.student-auth-submit').disabled");
      assert.equal(await value("document.querySelectorAll('[role=alert]').length"), 1);
      assert.equal(await value("document.body.textContent.includes('Registered email is required')"), false);
      assert.equal(await value("document.body.textContent.includes('Account Successfully Registered')"), false);
      if (["incorrect", "expired", "reused", "rate-limited"].includes(mode)) {
        assert.equal(requests.some(r => r.path.endsWith("/link-student-identity")), false);
        assert.equal(await value(mode === "rate-limited" ? "document.body.textContent.includes('Too many verification attempts')" : "document.body.textContent.includes('incorrect, expired or already used')"), true);
      }
    }
    assert.equal(requests.filter(r => r.action === "verify_access").length, 1, "rapid repeated submission sends one verification request");
    results.push({ journey: scenario.name, status: "PASS" });
  }
  for (const scenario of [
    { name: "desktop login refresh and logout", mode: "login-success", width: 1280 },
    { name: "mobile login refresh and logout", mode: "login-success", width: 390 },
    ...["login-memberships-failure", "login-memberships-malformed", "login-memberships-empty", "login-catalog-failure"].map(mode => ({ name: mode, mode, width: 390 })),
    ...["login-profile-missing", "login-profile-forbidden", "login-rejected", "login-wrong-profile"].map(mode => ({ name: mode, mode, width: 390 })),
  ].filter(() => !organizationNotificationsOnly)) {
    mode = scenario.mode; requests.length = 0;
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: 900, deviceScaleFactor: 1, mobile: scenario.width < 600 });
    await send("Page.navigate", { url: origin + "/student-login" });
    await wait("!!document.querySelector('#student-login-number')");
    await type("#student-login-number", student.student_number);
    await type("#student-login-password", syntheticPassword);
    await value("document.querySelector('.student-auth-submit').click();document.querySelector('.student-auth-submit').click()");
    if (["login-memberships-failure", "login-memberships-malformed"].includes(mode)) {
      await wait("location.pathname === '/student/dashboard' && document.body.textContent.includes('Organizations unavailable')");
      assert.equal(await value("document.body.textContent.includes('You are not in any organizations yet.')"), false);
      assert.equal(await value("document.querySelector('.student-dashboard-brief-list') === null"), true);
      assert.equal(requests.filter(r => r.path.endsWith('/auth/v1/logout')).length, 0);
      mode = "login-success";
      await submit("section[role=alert] button");
      await wait("document.querySelectorAll('.student-org-grid-primary article').length === 2");
      assert.equal(await value("document.querySelector('.student-dashboard-brief-list dd').textContent"), "2");
    } else if (mode === "login-memberships-empty") {
      await wait("location.pathname === '/student/dashboard' && document.body.textContent.includes('You are not in any organizations yet.')");
      assert.equal(await value("document.querySelector('.student-dashboard-brief-list dd').textContent"), "0");
      assert.equal(await value("document.body.textContent.includes('Organizations unavailable')"), false);
    } else if (mode === "login-success" || mode === "login-catalog-failure") {
      await wait("location.pathname === '/student/dashboard' && !!document.querySelector('.student-sidebar')");
      await wait("document.querySelectorAll('.student-org-grid-primary article').length === 2");
      assert.equal(await value("document.querySelector('.student-dashboard-brief-list dd').textContent"), "2");
      assert.equal(await value("[...document.querySelectorAll('.student-org-grid-primary article h2')].map(e=>e.textContent.trim()).sort().join(',')"), "PSITS,WITSG");
      assert.equal(requests.filter(r => r.action === "login").length, 1);
      assert.equal(requests.filter(r => r.path.endsWith('/auth/v1/logout')).length, 0);
      assert.equal(await value("JSON.parse(localStorage.getItem('user')).student_number"), student.student_number);
      assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
      await value("window.__beforeLoginReload = true");
      await send("Page.reload", { ignoreCache: true });
      await wait("!window.__beforeLoginReload && location.pathname === '/student/dashboard' && !!document.querySelector('.student-sidebar')");
      await wait("document.querySelectorAll('.student-org-grid-primary article').length === 2");
      assert.equal(await value("document.querySelector('.student-dashboard-brief-list dd').textContent"), "2");
      assert.ok(requests.filter(r => r.path.endsWith('/student-profile')).length >= 2, "refresh must reverify the authorized profile");
      await value("import('/src/utils/auth.js').then(module => module.signOutStudentSession())");
      await wait("location.pathname === '/student-login'");
      assert.equal(await value("localStorage.getItem('user')"), null);
      await send("Page.navigate", { url: origin + "/student/dashboard" });
      await wait("location.pathname === '/student-login'");
    } else {
      await wait("!!document.querySelector('.student-auth-inline-error') && !document.querySelector('.student-auth-submit').disabled");
      const text = await value("document.querySelector('.student-auth-inline-error').textContent");
      assert.equal(await value("location.pathname"), "/student-login");
      if (mode.startsWith("login-profile")) {
        assert.ok(text.includes("sign-in succeeded"));
        assert.equal(requests.filter(r => r.path.endsWith('/auth/v1/logout')).length, 0);
      } else if (mode === "login-rejected") {
        assert.ok(text.includes("Check your Student ID and password"));
        assert.equal(requests.filter(r => r.path.endsWith('/student-profile')).length, 0);
      } else {
        assert.ok(text.includes("does not match"));
        assert.equal(requests.filter(r => r.path.endsWith('/auth/v1/logout')).length, 1);
      }
    }
    results.push({ journey: scenario.name, status: "PASS" });
  }
  for (const width of [1280, 390]) {
    mode = "login-success"; requests.length = 0;
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin + "/student-login" });
    await wait("!!document.querySelector('#student-login-number')");
    await type("#student-login-number", student.student_number);
    await type("#student-login-password", syntheticPassword);
    await submit(".student-auth-submit");
    await wait("document.querySelectorAll('.student-org-grid-primary article').length === 2");
    for (const name of ["WITSG", "PSITS"]) {
      await value(`Array.from(document.querySelectorAll('.student-org-grid-primary article')).find(e=>e.textContent.includes('${name}')).querySelector('button').click()`);
      await wait("document.querySelector('.student-org-detail-stats')?.textContent.includes('2 active members')");
      assert.equal(await value("document.querySelector('.student-org-detail-stats').textContent.includes('3 elections')"), true);
      assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
      await submit(".student-back-link");
    }
    mode = "count-zero";
    await submit(".student-org-grid-primary article button");
    await wait("document.querySelector('.student-org-detail-stats')?.textContent.includes('0 active members')");
    assert.equal(await value("document.querySelector('.student-org-detail-stats').textContent.includes('3 elections')"), true);
    await submit(".student-back-link");
    mode = "count-error";
    await submit(".student-org-grid-primary article button");
    await wait("document.querySelector('.student-org-detail-stats')?.textContent.includes('Member count unavailable')");
    assert.equal(await value("document.querySelector('.student-org-detail-stats').textContent.includes('3 elections')"), true);
    assert.equal(await value("document.querySelector('.student-org-detail-stats').textContent.includes('0 active members')"), false);
    mode = "notifications-loaded";
    await submit(".student-back-link");
    await value("Array.from(document.querySelectorAll('button[aria-label]')).find(e=>e.getAttribute('aria-label').includes('notifications') && e.getBoundingClientRect().width > 0).click()");
    await wait("document.querySelectorAll('.notification-page-row').length === 1");
    await submit(".notification-page-row");
    await wait("document.querySelector('[role=alert]')?.textContent.includes('read state could not be saved')");
    assert.equal(await value("document.querySelector('.notification-page-row').classList.contains('is-unread')"), true);
    await send("Page.reload", { ignoreCache: true });
    await wait("document.querySelectorAll('.notification-page-row').length === 1");
    assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"), true);
    mode = "notifications-empty";
    await send("Page.reload", { ignoreCache: true });
    await wait("document.body.textContent.includes('Nothing needs your attention.')");
    mode = "notifications-error";
    await send("Page.reload", { ignoreCache: true });
    await wait("document.querySelector('.notifications-empty-state.is-error') !== null");
    assert.equal(await value("document.body.textContent.includes('Nothing needs your attention.')"), false);
    const attempts = requests.filter(r => r.path.endsWith('/student-notifications')).length;
    await value("for(let i=0;i<10;i++) window.dispatchEvent(new Event('focus'))");
    await delay(400);
    assert.equal(requests.filter(r => r.path.endsWith('/student-notifications')).length, attempts);
    mode = "notifications-loaded";
    await submit(".notifications-empty-state.is-error button");
    await wait("document.querySelectorAll('.notification-page-row').length === 1");
    results.push({ journey: `${width}px organization counts and notification states, refresh, retry, failed acknowledgement, focus throttle`, status: "PASS" });
  }
  assert.deepEqual(unexpectedBackends, []); assert.deepEqual(exceptions, []); assert.deepEqual(localFailures, []);
  assert.deepEqual(networkFailures.filter(failure => failure.cors), []);
  console.log(JSON.stringify({ results, realSupabaseRequests: 0, realEmailsSent: 0, exceptions: exceptions.length, cancelledInterceptions, failedLocalRequests: localFailures }, null, 2));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await closeBrowser?.().catch(() => {}); ws.close(); await delay(200); }
  if (chrome.exitCode === null) chrome.kill();
}
