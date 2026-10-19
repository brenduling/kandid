// Actual GoTrue + PostgreSQL + Mailpit signup OTP validation. No cloud access.
// A new scratch database is created only on the exact verified disposable DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { randomBytes, createHmac, webcrypto } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, withKandidCors } from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const project = "kandid-board-e2e-20261016-8c19";
const dbContainer = `supabase_db_${project}`;
const network = `supabase_network_${project}`;
const root = resolve(import.meta.dirname, "..");
const suffix = randomBytes(6).toString("hex");
const database = `kandid_otp_${suffix}`;
const authContainer = `kandid-student-otp-${suffix}-auth`;
const templateContainer = `kandid-student-otp-${suffix}-template`;
const results = [], started = [];
let proxy;
function docker(args, extra = {}) { return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...extra }).trim(); }
function inspect(name) { return JSON.parse(docker(["inspect", name]))[0]; }
function envOf(service) { return Object.fromEntries(service.Config.Env.map(e => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; })); }
function literal(value) { return value === null ? "null" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`; }
function sql(query, db = database) {
  assert.ok(db === database || db === "postgres");
  return docker(["exec", "-i", dbContainer, "psql", "-X", "-h", "/var/run/postgresql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], { input: query });
}
function pass(name) { results.push({ test: name, status: "PASS" }); }
async function reachable(url) { for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.ok) return; } catch { /* startup only */ } await delay(250); } throw new Error("Local Auth startup failed"); }
try {
  const db = inspect(dbContainer), originalAuth = inspect(`supabase_auth_${project}`), mail = inspect(`supabase_inbucket_${project}`);
  assert.equal(db.Id, "6bd024cac2ec0f8ffac8ec31b322f5fa581b51f9e8139edfdb4fd0c30d2c4676");
  for (const c of [db, originalAuth, mail]) { assert.equal(c.Config.Labels["com.supabase.cli.project"], project); assert.equal(c.State.Running, true); assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [network]); }
  assert.equal(db.Mounts.find(m => m.Destination === "/var/lib/postgresql/data").Name, dbContainer);
  assert.equal(db.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
  assert.equal(mail.HostConfig.PortBindings["8025/tcp"][0].HostPort, "59324");
  const originalEnv = envOf(originalAuth);
  const dsn = new URL(originalEnv.GOTRUE_DB_DATABASE_URL);
  assert.equal(dsn.hostname, dbContainer); assert.equal(dsn.username, "supabase_auth_admin");
  assert.equal(originalEnv.GOTRUE_SMTP_HOST, mail.Name.slice(1));
  assert.ok(/^http:\/\/127\.0\.0\.1:59321\//.test(originalEnv.API_EXTERNAL_URL));
  assert.equal(sql(`select count(*) from pg_database where datname=${literal(database)};`, "postgres"), "0");
  sql(`create database ${database} owner postgres;`, "postgres");
  // Grant only this scratch database's schema ownership; do not change role
  // memberships or permissions in any existing database.
  docker(["exec", "-i", dbContainer, "psql", "-X", "-h", "/var/run/postgresql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], { input: `create schema auth authorization supabase_auth_admin; grant create on database ${database} to supabase_auth_admin;` });
  dsn.pathname = `/${database}`;
  sql(`create table public.students(id bigint generated always as identity primary key, student_number text unique not null, email text, status text not null check(status in ('pending','active','disabled')),auth_user_id uuid unique);
create table public.admin_users(id bigint generated always as identity primary key,auth_user_id uuid,email text,role text,status text);
create table public.student_term_enrollments(student_id bigint references public.students(id),academic_term_id integer,program text,year_level integer,enrollment_status text,primary key(student_id,academic_term_id));
alter table public.students enable row level security; alter table public.admin_users enable row level security;
grant usage on schema public to service_role; grant select,update on public.students,public.admin_users to service_role;`);
  // Install only into the newly named scratch database, never the application DB.
  sql(readFileSync(resolve(root, "supabase/migrations/20261014113000_secure_student_auth_entrypoints.sql"), "utf8"));
  docker(["run", "-d", "--name", templateContainer, "--label", "kandid.test-scope=student-otp", "--network", network, "--mount", `type=bind,src=${resolve(root, "supabase/templates")},dst=/templates,readonly`, "busybox:1.36.1", "httpd", "-f", "-p", "8080", "-h", "/templates"]);
  started.push(templateContainer);
  const jwtSecret = randomBytes(48).toString("hex");
  const authOnlyEnv = Object.fromEntries(Object.entries(originalEnv).filter(([name]) => /^(GOTRUE_|API_EXTERNAL_URL$)/.test(name) && name !== "GOTRUE_JWT_KEYS"));
  const testEnv = { ...authOnlyEnv,
    GOTRUE_DB_DATABASE_URL: dsn.toString(), GOTRUE_MAILER_AUTOCONFIRM: "false",
    GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_JWT_VALID_METHODS: "HS256", GOTRUE_JWT_VALIDMETHODS: "HS256",
    GOTRUE_MAILER_OTP_LENGTH: "6", GOTRUE_MAILER_OTP_EXP: "3600",
    GOTRUE_SMTP_MAX_FREQUENCY: "60s", GOTRUE_RATE_LIMIT_EMAIL_SENT: "20",
    GOTRUE_SMTP_HOST: mail.Name.slice(1), GOTRUE_SMTP_PORT: "1025",
    GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@example.invalid", GOTRUE_SMTP_USER: "", GOTRUE_SMTP_PASS: "",
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `http://${templateContainer}:8080/student_email_otp.html`,
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `http://${templateContainer}:8080/student_email_otp.html`,
    GOTRUE_SITE_URL: "http://localhost:5174", API_EXTERNAL_URL: "http://127.0.0.1:1",
  };
  // Values are inherited in process memory, never command arguments/files/logs.
  docker(["run", "-d", "--name", authContainer, "--label", "kandid.test-scope=student-otp", "--network", network, "-p", "127.0.0.1::9999", ...Object.keys(testEnv).flatMap(k => ["-e", k]), originalAuth.Config.Image], { env: { ...process.env, ...testEnv } });
  started.push(authContainer);
  const authInspect = inspect(authContainer);
  assert.deepEqual(Object.keys(authInspect.NetworkSettings.Networks), [network]);
  const port = authInspect.NetworkSettings.Ports["9999/tcp"][0];
  assert.equal(port.HostIp, "127.0.0.1");
  const authBase = `http://127.0.0.1:${port.HostPort}`;
  await reachable(authBase + "/health");
  proxy = createServer(async (req, res) => {
    try {
      assert.ok(req.url.startsWith("/auth/v1/"));
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
      const upstream = await fetch(authBase + req.url.slice("/auth/v1".length), { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { "Content-Type": "application/json" }); res.end(body);
    } catch { res.writeHead(502); res.end("{}"); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const key = role => { const encode = x => Buffer.from(JSON.stringify(x)).toString("base64url"); const h = encode({ alg: "HS256", typ: "JWT" }); const p = encode({ iss: "supabase", role, aud: "authenticated", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac("sha256", jwtSecret).update(`${h}.${p}`).digest("base64url")}`; };
  const anon = key("anon"), service = key("service_role");
  // Synchronous Docker assertions can block the driver past Node's keep-alive
  // window. Do not reuse stale local test-proxy sockets between assertions.
  const clientOptions = { global: { fetch(input, init) { const headers = new Headers(init?.headers); headers.set("Connection", "close"); return fetch(input, { ...init, headers }); } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(base, service, clientOptions);
  const auth = createClient(base, anon, clientOptions);
  const hmacSecret = randomBytes(48).toString("hex");
  function tableQuery(table) {
    assert.ok(["students", "admin_users", "student_term_enrollments"].includes(table));
    const filters = []; let update, single = false, limit = 10000;
    const column = name => { assert.ok(/^[a-z_]+$/.test(name)); return name; };
    const execute = async () => {
      try {
        const where = filters.length ? " where " + filters.join(" and ") : "";
        const statement = update ? `with changed as (update public.${table} set ${Object.entries(update).map(([k, v]) => `${column(k)}=${literal(v)}`).join(",")}${where} returning *) select coalesce(json_agg(row_to_json(t)), '[]'::json) from changed t;` : `select coalesce(json_agg(row_to_json(t)), '[]'::json) from (select * from public.${table}${where} limit ${limit}) t;`;
        const rows = JSON.parse(sql(statement));
        return { data: single ? rows[0] : rows, error: single && rows.length !== 1 ? { message: "Synthetic row mismatch" } : null };
      } catch { return { data: null, error: { message: "Scratch database query failed" } }; }
    };
    const q = { select() { return q; }, order() { return q; }, eq(k, v) { filters.push(`${column(k)}=${literal(v)}`); return q; }, is(k) { filters.push(`${column(k)} is null`); return q; }, not(k) { filters.push(`${column(k)} is not null`); return q; }, limit(n) { limit = Number(n); return q; }, update(value) { update = value; return q; }, single() { single = true; return execute(); }, then(a, b) { return execute().then(a, b); } }; return q;
  }
  const logs = [];
  function handler(name) {
    let run;
    const source = stripTypeScriptTypes(readFileSync(resolve(root, `supabase/functions/${name}/index.ts`), "utf8")).replace(/^import .*;\r?\n/gm, "");
    const env = { SUPABASE_URL: base, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: hmacSecret };
    runInNewContext(source, {
      Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout,
      fetch(url, init) {
        assert.equal(url, base + "/auth/v1/user");
        assert.equal(init.method, "PUT");
        return fetch(url, init);
      },
      console: { warn(...args) { logs.push(args.join(" ")); }, error() { logs.push("handler failure"); } },
      Deno: { env: { get(k) { return env[k]; } }, serve(fn) { run = fn; } },
      KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight, rejectDisallowedOrigin,
      serveWithKandidCors(fn) { run = async req => withKandidCors(req, await fn(req)); },
      createClient(url, credential, options) {
        assert.equal(url, base);
        const c = createClient(url, credential, { ...clientOptions, ...options });
        if (credential === service) {
          c.from = tableQuery;
          c.rpc = async (rpc, args) => {
            assert.equal(rpc, "kandid_consume_student_auth_rate_limit");
            const value = sql(`set role service_role; select public.kandid_consume_student_auth_rate_limit(${literal(args.p_requester_fingerprint)},${literal(args.p_student_fingerprint)},${literal(args.p_operation)});`);
            return { data: value.split("\n").at(-1) === "t", error: null };
          };
        }
        return c;
      },
    });
    return async (payload, token) => {
      const response = await run(new Request("http://localhost/synthetic", { method: "POST", headers: { Origin: "http://localhost:5174", "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.77", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(payload) }));
      return { status: response.status, data: await response.json(), retry: response.headers.get("Retry-After") };
    };
  }
  const resolver = handler("resolve-student-login"), linker = handler("link-student-identity");
  const studentNumber = "800001", email = `signup-${suffix}@example.invalid`;
  sql(`insert into public.students(student_number,email,status) values(${literal(studentNumber)},${literal(email)},'pending');`);
  sql(`insert into public.student_term_enrollments(student_id,academic_term_id,program,year_level,enrollment_status) select id,1,'BSIT',1,'enrolled' from public.students where student_number=${literal(studentNumber)};`);
  const state = () => JSON.parse(sql(`select row_to_json(t) from public.students t where student_number=${literal(studentNumber)};`));
  const mailFor = async recipient => {
    for (let i = 0; i < 80; i++) {
      const search = await (await fetch("http://127.0.0.1:59324/api/v1/search?query=" + encodeURIComponent("to:" + recipient))).json();
      const messages = search.messages || search.Messages || [];
      if (messages.length) {
        const message = await (await fetch(`http://127.0.0.1:59324/api/v1/message/${messages[0].ID}`)).json();
        const match = (message.Text || message.HTML || "").match(/\b\d{6}\b/);
        assert.ok(match, "Mailpit must receive an actual six-digit OTP template");
        return match[0];
      }
      await delay(100);
    }
    throw new Error("Synthetic Mailpit OTP was not delivered");
  };
  const sent = await resolver({ action: "begin_access", student_number: studentNumber });
  assert.equal(sent.status, 202); assert.equal(sent.data.data.delivery_confirmed, false);
  const code = await mailFor(email);
  const users = await admin.auth.admin.listUsers(); assert.equal(users.error, null);
  const user = users.data.users.find(u => u.email === email); assert.ok(user); assert.ok(!user.email_confirmed_at);
  assert.equal(state().status, "pending");
  pass("Real unconfirmed identity receives six-digit signup OTP only in isolated Mailpit");
  const resend = await resolver({ action: "begin_access", student_number: studentNumber });
  assert.equal(resend.status, 202); assert.equal(resend.data.data.delivery_confirmed, false);
  assert.ok(logs.some(s => s.includes("dispatch throttled")));
  pass("Actual Auth resend throttle is awaited/logged without false delivery confirmation");
  const wrongCode = code === "111111" ? "222222" : "111111";
  assert.equal((await resolver({ action: "verify_access", student_number: studentNumber, verification_code: wrongCode })).status, 401);
  assert.equal(state().status, "pending"); pass("Incorrect actual OTP cannot activate Student");
  const verified = await resolver({ action: "verify_access", student_number: studentNumber, verification_code: code });
  assert.equal(verified.status, 200); assert.equal(verified.data.data.authenticated, true);
  assert.equal(verified.data.data.student_details.details_verified, true);
  assert.equal(verified.data.data.student_details.enrollments[0].academic_term_id, 1);
  assert.equal(state().status, "pending"); pass("type=email verifies actual signup-confirmation OTP without activating Student early");
  const password = randomBytes(24).toString("base64url") + "!aA1";
  const linked = await linker({ student_number: studentNumber, setup_mode: true, password }, verified.data.data.session.access_token);
  assert.equal(linked.status, 200); assert.equal(linked.data.linked, true);
  assert.equal(state().status, "active"); assert.equal(state().auth_user_id, user.id);
  const login = await auth.auth.signInWithPassword({ email, password }); assert.equal(login.error, null); assert.equal(login.data.user.id, user.id);
  pass("Real verified identity/password and trusted linker activate only matching scratch Student; password sign-in succeeds");
  const preserved = JSON.stringify(state());
  assert.equal((await resolver({ action: "verify_access", student_number: studentNumber, verification_code: code })).status, 401);
  assert.equal(JSON.stringify(state()), preserved); pass("Consumed real OTP is rejected and active record is unchanged");
  const expiredNumber = "800002", expiredEmail = `expired-${suffix}@example.invalid`;
  sql(`insert into public.students(student_number,email,status) values(${literal(expiredNumber)},${literal(expiredEmail)},'pending');`);
  assert.equal((await resolver({ action: "begin_access", student_number: expiredNumber })).status, 202);
  const expiredCode = await mailFor(expiredEmail);
  // Expiry fixture touches only the newly created synthetic Auth user in this
  // scratch DB. Its Auth-owned table correctly rejects the application role.
  docker(["exec", "-i", dbContainer, "psql", "-X", "-h", "/var/run/postgresql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], { input: `update auth.users set confirmation_sent_at=now()-interval '2 hours' where email=${literal(expiredEmail)};` });
  assert.equal((await resolver({ action: "verify_access", student_number: expiredNumber, verification_code: expiredCode })).status, 401);
  assert.equal(sql(`select status from public.students where student_number=${literal(expiredNumber)};`), "pending");
  pass("Expired real signup OTP is rejected without Student activation");
  for (let n = 0; n < 2; n++) await resolver({ action: "begin_access", student_number: studentNumber });
  const limited = await resolver({ action: "begin_access", student_number: studentNumber });
  assert.equal(limited.status, 429); assert.equal(limited.retry, "900");
  pass("Actual SQL HMAC limiter retains setup quota and returns uniform cooldown");
  console.log(JSON.stringify({ database, project, authImage: originalAuth.Config.Image, localAuthPort: port.HostPort, mailpit: "127.0.0.1:59324", results, productionRequests: 0, realEmailsSent: 0, syntheticDatabaseRetained: true }, null, 2));
} finally {
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  for (const name of started.reverse()) {
    const c = inspect(name); assert.equal(c.Config.Labels["kandid.test-scope"], "student-otp");
    docker(["stop", "--time", "3", name]);
  }
}
