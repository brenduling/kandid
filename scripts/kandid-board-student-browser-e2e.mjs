// Isolated real-browser acceptance. No cloud URL or production credential is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createBoardStudentRegistrationHandler } from "../supabase/functions/board-manual-enrollment-complete-deploy/registryHandler.mjs";
import { withKandidCors } from "../supabase/functions/board-manual-enrollment-complete-deploy/kandidRegistryCors.mjs";

const repo = resolve(import.meta.dirname, "..");
const project = "kandid-board-e2e-20261016-8c19";
const container = `supabase_db_${project}`;
const upstream = "http://127.0.0.1:59321";
const proxyOrigin = "http://127.0.0.1:59420";
const appOrigin = "http://localhost:5173";
// Separate loopback binding preserves the existing localhost inspection server.
// Only this synthetic Chrome process maps localhost to that binding; the web
// Origin remains the already approved http://localhost:5173.
const appBinding = "127.0.0.2";
const portCheck = createServer();
await new Promise((accept, reject) => { portCheck.once("error", reject); portCheck.listen(5173, appBinding, accept); });
await new Promise((accept) => portCheck.close(accept));
const handlerPath = join(repo, "supabase/functions/board-manual-enrollment-complete-deploy/registryHandler.mjs");
assert.equal(createHash("sha256").update(readFileSync(handlerPath)).digest("hex"), "3dc873ddc503fc518f6b0abbda3f301d3f94f9a046d072cce7f2739820d197b4");
const inspection = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0];
assert.equal(inspection.Id, "6bd024cac2ec0f8ffac8ec31b322f5fa581b51f9e8139edfdb4fd0c30d2c4676");
assert.equal(inspection.Config.Labels["com.supabase.cli.project"], project);
assert.equal(inspection.Mounts.find((mount) => mount.Destination === "/var/lib/postgresql/data")?.Name, container);
assert.equal(inspection.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
assert.equal(inspection.State.Running, true);
const localRoot = join(process.env.LOCALAPPDATA, "Temp", project);
const secretFile = join(localRoot, "supabase", ".temp", "start-secrets", `supabase_edge_runtime_${project}`, "env", "docker.env");
const localEnv = Object.fromEntries(readFileSync(secretFile, "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const equals = line.indexOf("="); return [line.slice(0, equals), line.slice(equals + 1).replace(/^"|"$/g, "")];
}));
assert.ok(localEnv.SUPABASE_ANON_KEY && localEnv.SUPABASE_SERVICE_ROLE_KEY);
assert.equal(localEnv.SUPABASE_URL, "http://kong:8000", "credentials must come from the verified disposable stack's internal Kong configuration");
const anon = localEnv.SUPABASE_ANON_KEY;
const admin = createClient(upstream, localEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(query) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-h", "/var/run/postgresql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();
}
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const activeTerm = JSON.parse(sql("select row_to_json(t) from public.academic_terms t where status='active';"));
assert.ok(activeTerm.id);
const historyQuery = ["elections", "votes", "vote_ballots"].map((table) => `select '${table}',count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.${table} t`).concat([
  `select 'historical_enrollments',count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.student_term_enrollments t where academic_term_id<>${Number(activeTerm.id)}`,
  `select 'historical_memberships',count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) from public.student_organization_terms t where academic_term_id<>${Number(activeTerm.id)}`,
]).join(" union all ") + " order by 1;";
const historicalBefore = sql(historyQuery);
const suffix = randomBytes(5).toString("hex");
const password = randomBytes(24).toString("base64url") + "!aA1";
const email = `board-sm-${suffix}@example.invalid`;
const manualOrg = Number(sql("select id from public.organizations where membership_scope='manual' order by id limit 1;"));
assert.ok(manualOrg > 0);
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
assert.ifError(created.error);
sql(`insert into public.admin_users(full_name,email,role,status,organization_id,auth_user_id) values('Synthetic Acceptance Board',${literal(email)},'electoral_board','active',${manualOrg},${literal(created.data.user.id)});`);
const newNumber = sql("select candidate from generate_series(73100,73998) candidate where not exists(select 1 from public.students s where s.student_number=candidate::text) order by candidate limit 1;");
const existingNumber = sql(`select candidate from generate_series(74100,74998) candidate where not exists(select 1 from public.students s where s.student_number=candidate::text) order by candidate limit 1;`);
sql(`insert into public.students(student_number,first_name,last_name,program,year_level,status) values(${literal(existingNumber)},'Synthetic','Existing Identity','BSIT',2,'pending');`);

const actions = [];
let failNextEdit = false;
const handler = createBoardStudentRegistrationHandler({ createClient, getEnv: (name) => ({
  SUPABASE_URL: upstream, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: localEnv.SUPABASE_SERVICE_ROLE_KEY,
  // Scoped to this isolated process; no production secret or frontend flag changes.
  BOARD_STUDENT_REGISTRATION_ENABLED: "true", BOARD_STUDENT_MANAGEMENT_ENABLED: "true",
})[name] });
const proxy = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(proxyOrigin + incoming.url, { method: incoming.method, headers: incoming.headers, ...(body.length ? { body } : {}) });
    let response;
    if (new URL(request.url).pathname === "/functions/v1/board-manual-enrollment") {
      let action = "preflight";
      if (body.length) { try { action = JSON.parse(body).action; } catch { action = "invalid_json"; } }
      if (failNextEdit && action === "update_student_names") {
        failNextEdit = false;
        response = new Response(JSON.stringify({ error: "Synthetic temporary service failure." }), { status: 503, headers: { "Content-Type": "application/json" } });
      } else response = await handler(request);
      response = withKandidCors(request, response);
      let safeOutcome = null;
      try { const payload = await response.clone().json(); safeOutcome = payload?.code || payload?.data?.outcome || null; } catch { /* no response body is logged */ }
      actions.push({ action, status: response.status, outcome: safeOutcome });
    } else {
      response = await fetch(upstream + incoming.url, { method: incoming.method, headers: incoming.headers, ...(body.length ? { body } : {}), redirect: "manual" });
    }
    const headers = Object.fromEntries(response.headers);
    for (const header of ["content-encoding", "transfer-encoding", "content-length", "connection"]) delete headers[header];
    outgoing.writeHead(response.status, headers); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(502, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated proxy failure."}');
  }
});
await new Promise((accept, reject) => { proxy.once("error", reject); proxy.listen(59420, "127.0.0.1", accept); });
const temp = mkdtempSync(join(tmpdir(), "kandid-sm-browser-"));
const debugReservation = createServer();
await new Promise((accept,reject) => { debugReservation.once("error",reject); debugReservation.listen(0,"127.0.0.1",accept); });
const debugPort = debugReservation.address().port;
await new Promise((accept) => debugReservation.close(accept));
const vite = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"), "--config", join(repo,"scripts/vite-board-acceptance.config.mjs"), "--mode", "isolated-board-acceptance", "--host", appBinding, "--port", "5173", "--strictPort"], {
  cwd: repo, windowsHide: true, stdio: "ignore", env: { ...process.env, VITE_SUPABASE_URL: proxyOrigin, VITE_SUPABASE_KEY: anon,
    VITE_ENABLE_BOARD_STUDENT_REGISTRATION: "true", VITE_ENABLE_BOARD_STUDENT_MANAGEMENT: "true", KANDID_BOARD_ACCEPTANCE_CACHE_DIR: join(temp,"vite-cache") },
});
let chrome, ws;
const results = [];
const pass = (label) => { results.push({ workflow: label, status: "PASS" }); console.log(`PASS ${label}`); };
async function reachable(url, limit = 20000) {
  const until = Date.now() + limit;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* retry local startup */ } await delay(150); }
  throw new Error("Isolated local service startup failed.");
}
try {
  await reachable(`http://${appBinding}:5173`);
  assert.equal(vite.exitCode, null, "test Vite must own its selected port");
  chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--host-resolver-rules=MAP localhost 127.0.0.2", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${join(temp, "chrome")}`], { windowsHide: true, stdio: "ignore" });
  await reachable(`http://127.0.0.1:${debugPort}/json/version`);
  const tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${appOrigin}/board-login`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0; const pending = new Map(); const exceptions = []; const failedRequests = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error("CDP command failed")) : p.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      failedRequests.push({ path: new URL(message.params.response.url).pathname, status: message.params.response.status });
    }
  };
  const send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial; pending.set(id, { resolve: accept, reject }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("CDP command timeout")); } }, 20000).unref();
  });
  const value = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error("Browser expression failed");
    return result.result?.value;
  };
  const wait = async (expression, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await value(expression)) return; await delay(120); }
    const visibleAlert = await value("document.querySelector('[role=alert]')?.textContent || ''");
    const fields = await value("[...document.querySelectorAll('form input')].map(e=>({id:e.id,empty:!e.value,valid:e.validity.valid}))");
    const page = await value("({path:location.pathname,headings:[...document.querySelectorAll('h1')].map(e=>e.textContent),body:document.body.textContent.slice(0,180)})");
    console.log(JSON.stringify({ diagnostic: label, page, alert: String(visibleAlert).slice(0,350), fields, actions, failedRequests, exceptions }));
    throw new Error(`Browser acceptance failed: ${label}`);
  };
  const type = async (selector, text) => {
    // Let a newly mounted modal finish its focus-trap effect before typing.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(200);
      assert.equal(await value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select?.();return true})()`), true, `input ${selector} exists`);
      await send("Input.insertText", { text: String(text) });
      await delay(100);
      if (await value(`document.querySelector(${JSON.stringify(selector)})?.value`) === String(text)) return;
    }
    assert.fail(`typed input ${selector}`);
  };
  const click = async (text) => {
    const clicked = await value(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().toLowerCase()===${JSON.stringify(text.toLowerCase())});if(!e||e.disabled)return false;e.click();return true})()`);
    assert.equal(clicked, true, `click ${text}`);
  };
  const row = (number) => `[...document.querySelectorAll('.board-student-record:not(.is-skeleton)')].find(e=>e.textContent.includes(${JSON.stringify(number)}))`;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["*://*.supabase.co/*", "*://witkandid.vercel.app/*", "*://127.0.0.1:55321/*", "*://localhost:55321/*"] });
  await send("Page.navigate", { url: `${appOrigin}/board-login` });
  await wait("!!document.querySelector('#board-login-email')", "Board login renders");
  await type("#board-login-email", email); await type("#board-login-password", password);
  await value("document.querySelector('form button[type=submit]').click()");
  await wait("location.pathname==='/board/dashboard'", "real isolated Board Auth login");
  await wait("!!document.querySelector('a[href=\"/board/students\"]')", "authenticated Board shell renders");
  await send("Page.navigate", { url: `${appOrigin}/board/students` });
  await wait("document.querySelector('h1')?.textContent==='Students'", "Students registry loads");
  await wait("!document.querySelector('.board-registry-error')", "initial registry response");
  await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Add Student'&&!e.disabled)", "trusted organization context finishes loading");
  pass("Authenticated isolated Board session and registry");

  async function register(number, existing) {
    await click("Add Student"); await wait("!!document.querySelector('#registration-student-id')", "lookup form");
    await type("#registration-student-id", number);
    await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Check Student ID'&&!e.disabled)", "active-term verification finishes");
    await click("Check Student ID");
    const prefix = existing ? "#board-registration-existing-" : "#board-registration-";
    await wait(`!!document.querySelector(${JSON.stringify(prefix + "first")})`, "correct new/existing identity branch");
    if (!existing) {
      await type(prefix + "first", "Synthetic"); await type(prefix + "last", "Browser Acceptance");
      await type(prefix + "program", "BSIT"); await type(prefix + "year", "2");
    }
    await click("Continue to review");
    await wait("document.body.textContent.includes('Confirm that valid enrollment evidence')", "invalid evidence feedback");
    await value("document.querySelector('.board-registration-evidence-confirm input').click()");
    await click("Continue to review");
    await wait("document.body.textContent.includes('Review registration')", "registration review");
    await value("document.querySelector('form.sa-registration-workspace button[type=submit]').click()");
    await wait("!document.querySelector('#board-registration-title')", "successful registration closes modal");
    await type(".board-students-search input", number);
    await wait(`!!(${row(number)})`, "registry refresh shows registered student");
    await wait("document.body.textContent.includes('Student registered to')", "registration success message");
    pass(existing ? "Enroll eligible existing identity through browser and refresh registry" : "Add new identity through browser and refresh registry");
  }
  await register(newNumber, false);
  await register(existingNumber, true);
  await click("Add Student"); await type("#registration-student-id", newNumber);
  await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Check Student ID'&&!e.disabled)", "duplicate lookup term context");
  await click("Check Student ID");
  await wait("document.body.textContent.toLowerCase().includes('already a member')", "duplicate enrollment feedback");
  assert.equal(sql(`select count(*) from public.student_term_enrollments e join public.students s on s.id=e.student_id where s.student_number=${literal(newNumber)} and e.academic_term_id=${activeTerm.id};`), "1");
  await value("document.querySelector('.popup-close').click()"); pass("Duplicate enrollment is stopped and remains one row");
  await type(".board-students-search input", newNumber); await wait(`!!(${row(newNumber)})`, "selected registry row");
  await value(`(${row(newNumber)}).querySelector('button[aria-label^=Edit]').click()`);
  await wait("!!document.querySelector('#board-student-edit-first')", "name edit opens");
  await type("#board-student-edit-first", "Corrected Synthetic");
  failNextEdit = true; await click("Save changes");
  await wait("document.body.textContent.includes('Synthetic temporary service failure')", "server error feedback");
  assert.equal(sql(`select first_name='Synthetic' from public.students where student_number=${literal(newNumber)};`), "t");
  pass("Failed name save shows error and preserves database");
  await click("Save changes"); await wait("!document.querySelector('#board-student-edit-first')", "successful name save");
  await wait(`(${row(newNumber)})?.textContent.includes('Corrected Synthetic')`, "edited registry refreshed");
  await wait("document.body.textContent.includes('Student record updated.')", "name edit success message");
  assert.equal(sql(`select first_name='Corrected Synthetic' from public.students where student_number=${literal(newNumber)};`), "t"); pass("Edit name persists and refreshes browser registry");
  await value(`(${row(newNumber)}).querySelector('button.is-remove').click()`);
  await wait("!!document.querySelector('#board-student-remove-confirm')", "remove form");
  await value("(()=>{const e=document.querySelector('#board-student-remove-reason');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'Administrative correction');e.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await type("#board-student-remove-confirm", newNumber); await type("#board-student-remove-password", "invalid-synthetic-password");
  await value("document.querySelector('button.danger-btn').click()");
  await wait("document.body.textContent.includes('password could not be verified')", "real Auth password failure feedback");
  assert.equal(sql(`select p.status='active' from public.student_organization_terms p join public.students s on s.id=p.student_id where s.student_number=${literal(newNumber)} and p.organization_id=${manualOrg} and p.academic_term_id=${activeTerm.id};`), "t");
  pass("Removal rejects invalid real Auth reauthentication");
  await type("#board-student-remove-password", password); await value("document.querySelector('button.danger-btn').click()");
  await wait("!document.querySelector('#board-student-remove-confirm')", "successful membership removal");
  await wait(`!(${row(newNumber)})`, "Active registry refresh after remove");
  await click("Removed"); await wait(`!!(${row(newNumber)})`, "Removed registry refresh"); pass("Remove manual membership and refresh Active/Removed registries");
  await wait("document.body.textContent.includes('removed from')", "removal success message");
  await value(`(${row(newNumber)}).querySelector('button.is-restore').click()`); await click("Confirm Restore");
  await wait(`!(${row(newNumber)})`, "Removed registry refresh after restore"); await click("Active");
  await wait(`!!(${row(newNumber)})`, "Active registry refresh after restore"); pass("Restore manual membership and refresh both registries");
  await wait("document.body.textContent.includes('restored to')", "restore success message");
  assert.equal(sql(`select p.status from public.student_organization_terms p join public.students s on s.id=p.student_id where s.student_number=${literal(newNumber)} and p.organization_id=${manualOrg} and p.academic_term_id=${activeTerm.id};`), "active");

  const studentId = Number(sql(`select id from public.students where student_number=${literal(newNumber)};`));
  assert.equal(sql(`select e.verified_at is not null and e.verification_method='school_id' and a.auth_user_id=${literal(created.data.user.id)}::uuid from public.student_term_enrollments e join public.admin_users a on a.id=e.verified_by_admin_id where e.student_id=${studentId} and e.academic_term_id=${activeTerm.id};`), "t");
  assert.equal(sql(`select not exists(select 1 from public.organizations o where (o.membership_scope='institution' or (o.membership_scope='program' and exists(select 1 from public.organization_programs op join public.programs p on p.id=op.program_id where op.organization_id=o.id and p.code='BSIT'))) and not exists(select 1 from public.student_organization_terms m where m.organization_id=o.id and m.student_id=${studentId} and m.academic_term_id=${activeTerm.id} and m.status='active'));`), "t");
  assert.equal(sql(`select exists(select 1 from public.audit_logs where entity_id=${literal(studentId)} and organization_id=${manualOrg} and event_type='membership_restored') and exists(select 1 from public.audit_logs where entity_id=${literal(studentId)} and organization_id=${manualOrg} and event_type='student_identity_updated');`), "t");
  pass("Real PostgreSQL verification, all configured mappings, and management audit attribution");

  const foreignOrg = Number(sql("select o.id from public.organizations o where o.membership_scope='program' and exists(select 1 from public.organization_programs op where op.organization_id=o.id) and not exists(select 1 from public.organization_programs op join public.programs p on p.id=op.program_id where op.organization_id=o.id and p.code='BSIT') order by o.id limit 1;"));
  assert.ok(foreignOrg > 0);
  const foreignEmail = `foreign-sm-${suffix}@example.invalid`;
  const foreignUser = await admin.auth.admin.createUser({ email: foreignEmail, password, email_confirm: true }); assert.ifError(foreignUser.error);
  sql(`insert into public.admin_users(full_name,email,role,status,organization_id,auth_user_id) values('Synthetic Foreign Board',${literal(foreignEmail)},'electoral_board','active',${foreignOrg},${literal(foreignUser.data.user.id)});`);
  const foreignClient = createClient(upstream,anon,{ auth:{persistSession:false,autoRefreshToken:false} });
  const foreignSession = await foreignClient.auth.signInWithPassword({email:foreignEmail,password}); assert.ifError(foreignSession.error);
  async function foreignRequest(body) {
    return fetch(`${proxyOrigin}/functions/v1/board-manual-enrollment`,{method:"POST",headers:{Authorization:`Bearer ${foreignSession.data.session.access_token}`,apikey:anon,"Content-Type":"application/json"},body:JSON.stringify(body)});
  }
  assert.equal((await foreignRequest({action:"update_student_names",student_id:studentId,changes:{first_name:"Forbidden",last_name:"Change"}})).status,403);
  assert.equal((await foreignRequest({action:"list_students",organization_id:manualOrg})).status,403);
  assert.equal((await foreignRequest({action:"enroll_existing_student_for_term",student:{student_number:newNumber,first_name:"Forbidden",last_name:"Change",program:"BSIT",year_level:2},verification_method:"school_id",evidence_reviewed:true})).status,403);
  const direct = await foreignClient.rpc("kandid_board_register_verified_student_for_term_v1",{
    p_actor_admin_id:1,p_board_organization_id:manualOrg,p_student_number:newNumber,
    p_first_name:"Forbidden",p_last_name:"Change",p_email:null,p_program:"BSIT",p_year_level:2,
    p_verification_method:"school_id",p_evidence_reviewed:true,p_create_identity:false,
    p_photo_url:null,p_precinct_code:null,p_batch_code:null,
  });
  assert.equal(direct.error?.code,"42501","direct browser-role registration RPC permission denied, not an unresolved signature");
  const directEdit = await foreignClient.from("students").update({first_name:"Forbidden"}).eq("id",studentId);
  assert.ok(directEdit.error,"direct browser-role table update denied");
  assert.equal(sql(`select first_name='Corrected Synthetic' from public.students where id=${studentId};`),"t");
  pass("Real authenticated foreign Board cannot edit, enroll, choose another registry scope, or bypass RPC/table permissions");
  assert.equal(sql(historyQuery), historicalBefore); pass("Historical elections, votes, ballots, enrollments and memberships unchanged");
  assert.deepEqual(exceptions, [], "no unhandled browser exceptions");
  console.log(JSON.stringify({ isolation: project, postgres: sql("show server_version;"), browser_acceptance: results, actions: actions.filter((entry) => entry.action !== "preflight") }));
  await send("Browser.close");
} finally {
  ws?.close(); chrome?.kill(); vite.kill(); proxy.closeAllConnections(); await new Promise((accept) => proxy.close(accept));
}
