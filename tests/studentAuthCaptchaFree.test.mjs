import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { readStudentSetupRecognition } from "../src/utils/studentSetupRecognition.js";
import {
  KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight,
  rejectDisallowedOrigin, withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

// Execute the real handler code with synthetic in-memory services. No production
// credentials, external network, email delivery or database connection is used.
const sources = Object.fromEntries(await Promise.all(["resolve-student-login", "resolve-student-login-inspect-deploy", "resolve-student-login-recognition-deploy", "link-student-identity", "student-profile-readonly-deploy"].map(async (name) => {
  const source = await readFile(new URL("../supabase/functions/" + name + "/index.ts", import.meta.url), "utf8");
  return [name, stripTypeScriptTypes(source).replace(/^import .*;\r?\n/gm, "")];
})));
const resolverV7 = JSON.parse(await readFile(new URL("./fixtures/studentSetupResolverV7.json", import.meta.url), "utf8"));
sources["resolver-v7-baseline"] = stripTypeScriptTypes(resolverV7.files.find(file => file.name.endsWith("resolve-student-login/index.ts")).content)
  .replace(/^import .*;\r?\n/gm, "");
const student = {
  id: 42, student_number: "700001", email: "synthetic.student@example.invalid",
  status: "active", auth_user_id: "synthetic-auth",
};
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 };
const verifiedUser = { id: "synthetic-auth", email: student.email, email_confirmed_at: "2026-10-17T00:00:00Z" };
const credentials = { action: "login", student_number: student.student_number, password: "Synthetic!9" };
const setup = { action: "begin_access", student_number: student.student_number };
const verification = { action: "verify_access", student_number: student.student_number, verification_code: "000000" };
const linking = { student_number: student.student_number, setup_mode: true, password: "Synthetic!9" };
const authorized = { Authorization: "Bearer synthetic-session" };

export function harness(name = "resolve-student-login", options = {}) {
  const events = [];
  const pending = [];
  const logs = [];
  const requestedEnv = [];
  const db = { academic_terms: [{ id: 1, academic_year: "2026-2027", semester: "First", status: "active" }], student_organization_terms: [{student_id:42,academic_term_id:1,organization_id:2,status:"active"}], organizations: [{id:2,name:"Synthetic Student Government"}], students: structuredClone(options.students || [student]), admin_users: structuredClone(options.admins || []), student_term_enrollments: [{ student_id: student.id, academic_term_id: 1, program: "BSIT", year_level: 1, enrollment_status: "enrolled" }] };
  Object.assign(db, structuredClone(options.tables || {}));
  const users = structuredClone(options.authUsers || [verifiedUser]);
  const env = {
    SUPABASE_URL: "https://synthetic-project.invalid", SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: "x".repeat(48),
    ...options.env,
  };
  let handler;
  function record(kind, data) { events.push({ kind, data: structuredClone(data) }); }
  function tableQuery(table) {
    const filters = [];
    let changes;
    let limit = Infinity;
    let single = false;
    let offset = 0;
    let counted = false;
    async function execute() {
      record("table", { table, operation: changes ? "update" : "read" });
      if (options.databaseError || options.readErrorTable === table) return { data: null, error: { message: "Synthetic database failure" } };
      options.beforeRead?.(table, db, events);
      const matching = db[table].filter((row) => filters.every((predicate) => predicate(row)));
      const count = matching.length;
      const rows = matching.slice(offset, offset + Math.min(limit, options.rowCap || Infinity));
      if (changes) rows.forEach((row) => Object.assign(row, changes));
      return { data: structuredClone(single ? rows[0] : rows), error: null, count: counted ? count : null };
    }
    const query = {
      select(_columns, settings) { counted = settings?.count === "exact"; return query; },
      range(start, end) { offset = start; limit = end - start + 1; return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      is(key, value) { filters.push((row) => row[key] === value); return query; },
      not(key, operator, value) { assert.equal(operator, "is"); filters.push((row) => row[key] !== value); return query; },
      limit(value) { limit = value; return query; },
      order() { return query; },
      update(value) { changes = value; return query; },
      single() { single = true; return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }
  const admin = {
    from: tableQuery,
    async rpc(rpcName, args) {
      record("rate", { rpcName, args });
      if (options.rateThrows) throw new Error("Synthetic unavailable rate limiter");
      return { data: options.rateAllowed !== false, error: options.rateError ? { message: "Synthetic rate failure" } : null };
    },
    auth: { admin: {
      async listUsers() { record("listUsers"); return { data: { users }, error: null }; },
      async getUserById(id) { record("getUser"); return { data: { user: users.find((u) => u.id === id) }, error: null }; },
      async createUser(payload) {
        record("createUser", payload);
        const user = { id: "synthetic-new-auth", email: payload.email };
        users.push(user);
        return { data: { user }, error: null };
      },
    } },
  };
  const auth = { auth: {
    async getUser() { return { data: { user: options.user || verifiedUser }, error: options.invalidSession ? { message: "Synthetic invalid session" } : null }; },
    async signInWithPassword(payload) {
      record("password", payload);
      if (options.authThrows) throw new Error("Synthetic Auth network failure");
      return options.badPassword
        ? { data: { session: null, user: null }, error: { message: "Synthetic bad credentials" } }
        : { data: { session, user: { ...verifiedUser, id: options.signInUserId || verifiedUser.id } }, error: null };
    },
    async signInWithOtp(payload) {
      record("sendOtp", payload);
      if (options.dispatchWait) await options.dispatchWait;
      if (options.sendThrows) throw new Error("Synthetic mail outage");
      return { error: options.sendError ? { message: "Synthetic mail failure", status: options.sendStatus } : null };
    },
    async verifyOtp(payload) {
      record("verifyOtp", payload);
      return options.invalidOtp
        ? { data: { session: null, user: null }, error: { message: "Synthetic invalid/expired code" } }
        : { data: { session, user: options.otpUser || { ...verifiedUser, id: options.verifiedUserId || verifiedUser.id } }, error: null };
    },
    async updateUser(payload) { record("passwordUpdate", payload); return { error: options.passwordUpdateError ? { message: "Synthetic password failure" } : null }; },
  } };
  const context = {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto: webcrypto,
    console: { warn(...args) { logs.push(args); }, error(...args) { logs.push(args); } },
    setTimeout(callback, delay) { record("delay", delay); callback(); },
    async fetch(url, init) {
      assert.equal(url, env.SUPABASE_URL + "/auth/v1/user");
      assert.equal(init.method, "PUT");
      assert.equal(init.headers.Authorization, authorized.Authorization);
      assert.equal(init.headers.apikey, env.SUPABASE_ANON_KEY);
      record("passwordUpdate", JSON.parse(init.body));
      if (options.passwordUpdateThrows) throw new Error("Synthetic self-service failure");
      return new Response(JSON.stringify(options.passwordResponseUser || options.user || verifiedUser), { status: options.passwordUpdateError ? 400 : 200 });
    },
    createClient(url, key) {
      assert.equal(url, env.SUPABASE_URL);
      assert.ok(key === env.SUPABASE_ANON_KEY || key === env.SUPABASE_SERVICE_ROLE_KEY);
      return key === env.SUPABASE_SERVICE_ROLE_KEY ? admin : auth;
    },
    KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight, rejectDisallowedOrigin,
    serveWithKandidCors(fn) { handler = async (request) => withKandidCors(request, await fn(request)); },
    Deno: { env: { get(key) { requestedEnv.push(key); return env[key]; } }, serve(fn) { handler = fn; } },
    EdgeRuntime: { waitUntil(promise) { pending.push(promise); } },
  };
  runInNewContext(sources[name], context, { filename: name + "/index.ts" });
  return {
    events, db, requestedEnv, logs,
    async invoke(payload, headers = {}, requestOptions = {}) {
      const requestHeaders = new Headers({ Origin: "http://localhost:5174", "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.10" });
      for (const [key, value] of Object.entries(headers)) {
        if (value === null) requestHeaders.delete(key); else requestHeaders.set(key, value);
      }
      const method = requestOptions.method || "POST";
      const response = await handler(new Request("https://function.invalid", {
        method, headers: requestHeaders,
        body: method === "GET" ? undefined : requestOptions.rawBody ?? JSON.stringify(payload),
      }));
      await Promise.all(pending);
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

test("password login without CAPTCHA authenticates only the linked active identity after HMAC rate limiting", async () => {
  const h = harness();
  const result = await h.invoke({ ...credentials, email: "untrusted@example.invalid" });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.authenticated, true);
  assert.equal(h.events[0].kind, "rate");
  const rate = h.events[0].data;
  assert.equal(rate.rpcName, "kandid_consume_student_auth_rate_limit");
  assert.equal(rate.args.p_operation, "login");
  assert.match(rate.args.p_requester_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(rate.args.p_student_fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(h.events.find((e) => e.kind === "password").data, { email: student.email, password: credentials.password });
  assert.ok(h.requestedEnv.every((key) => !/turnstile|captcha/i.test(key)));
});

for (const [action, payload, operation, status] of [["login", credentials, "login", 429], ["setup", setup, "setup", 429], ["verify", verification, "verify", 429]]) {
  test(action + " rate-limit denial never reaches Auth, provisioning or student lookup", async () => {
    const h = harness("resolve-student-login", { rateAllowed: false });
    const result = await h.invoke(payload);
    assert.equal(result.status, status);
    assert.deepEqual(h.events.map((e) => e.kind), ["rate"]);
    assert.equal(h.events[0].data.args.p_operation, operation);
  });
}

test("a missing/short HMAC key or untrusted source address fails closed before any service call", async () => {
  for (const env of [{ STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: undefined }, { STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: "short" }]) {
    const h = harness("resolve-student-login", { env });
    assert.equal((await h.invoke(credentials)).status, 503);
    assert.equal(h.events.length, 0);
  }
  const h = harness();
  assert.equal((await h.invoke(credentials, { "cf-connecting-ip": null, "x-forwarded-for": "198.51.100.12" })).status, 503);
  assert.equal(h.events.length, 0);
});

test("rate-limit RPC error or exception never permits authentication", async () => {
  for (const option of [{ rateError: true }, { rateThrows: true }]) {
    const h = harness("resolve-student-login", option);
    const result = await h.invoke(credentials);
    assert.ok([429, 503].includes(result.status));
    assert.deepEqual(h.events.map((e) => e.kind), ["rate"]);
  }
});

test("missing, pending, disabled, wrong-password and mismatched Auth identities yield the same generic login failure", async () => {
  for (const options of [
    { students: [] }, { students: [{ ...student, status: "pending", auth_user_id: null }] },
    { students: [{ ...student, status: "disabled" }] }, { badPassword: true },
    { signInUserId: "another-identity" }, { authThrows: true },
  ]) {
    const h = harness("resolve-student-login", options);
    const result = await h.invoke(credentials);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { data: { authenticated: false } });
    assert.ok(!h.events.some((e) => ["createUser", "passwordUpdate"].includes(e.kind)));
    assert.ok(h.events.some((e) => e.kind === "delay"));
  }
});

test("hostile origins and unknown actions cannot consume rate buckets or reach Auth", async () => {
  const hostile = harness();
  assert.equal((await hostile.invoke(credentials, { Origin: "https://hostile.invalid" })).status, 403);
  assert.equal(hostile.events.length, 0);
  const unknown = harness();
  assert.equal((await unknown.invoke({ ...credentials, action: "arbitrary_write" })).status, 401);
  assert.equal(unknown.events.length, 0);
});

test("setup provisions only a missing unconfirmed Auth identity and sends OTP to the stored email without activating the student", async () => {
  const pendingStudent = { ...student, status: "pending", auth_user_id: null };
  const h = harness("resolve-student-login", { students: [pendingStudent], authUsers: [] });
  const result = await h.invoke({ ...setup, email: "untrusted@example.invalid" });
  assert.equal(result.status, 202);
  assert.deepEqual(h.events.find((e) => e.kind === "createUser").data, { email: student.email, email_confirm: false });
  assert.deepEqual(h.events.find((e) => e.kind === "sendOtp").data, { email: student.email, options: { shouldCreateUser: false } });
  assert.deepEqual(h.db.students, [pendingStudent]);
  assert.deepEqual(result.body, { data: { verification_requested: true, delivery_confirmed: false, retry_after_seconds: 60 } });
});

test("setup reuses an existing email identity and never auto-creates a duplicate Auth account", async () => {
  const h = harness("resolve-student-login", { students: [{ ...student, status: "pending", auth_user_id: null }] });
  assert.equal((await h.invoke(setup)).status, 202);
  assert.equal(h.events.filter((e) => e.kind === "createUser").length, 0);
  assert.equal(h.events.filter((e) => e.kind === "sendOtp").length, 1);
});

test("privileged identity collisions cannot receive Student setup OTP", async () => {
  const h = harness("resolve-student-login", { admins: [{ id: 1, auth_user_id: student.auth_user_id, email: student.email }] });
  assert.equal((await h.invoke(setup)).status, 202);
  assert.equal(h.events.filter((e) => ["sendOtp", "createUser"].includes(e.kind)).length, 0);
});

test("unknown IDs and mail failure preserve generic setup responses without revealing identity details", async () => {
  const unknown = harness("resolve-student-login", { students: [] });
  const known = harness("resolve-student-login", { sendError: true });
  const a = await unknown.invoke(setup);
  const b = await known.invoke(setup);
  assert.equal(a.status, 202);
  assert.deepEqual(a.body, b.body);
  assert.equal(unknown.events.filter((e) => e.kind === "createUser").length, 0);
  assert.equal(unknown.events.find((e) => e.kind === "sendOtp").data.options.shouldCreateUser, false);
});

test("OTP verification accepts only the registered email and matching Auth identity; wrong or expired codes stay generic", async () => {
  const good = harness();
  assert.equal((await good.invoke(verification)).status, 200);
  assert.equal(good.events.find((e) => e.kind === "verifyOtp").data.email, student.email);
  for (const [options, payload] of [
    [{ invalidOtp: true }, verification], [{ verifiedUserId: "another-identity" }, verification],
    [{}, { ...verification, registered_email: "untrusted@example.invalid" }],
    [{ otpUser: { ...verifiedUser, email: "another@example.invalid" } }, verification],
    [{ otpUser: { ...verifiedUser, email_confirmed_at: null } }, verification],
  ]) {
    const h = harness("resolve-student-login", options);
    const result = await h.invoke(payload);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { data: { authenticated: false } });
    assert.ok(!h.events.some((e) => ["createUser", "passwordUpdate"].includes(e.kind)));
  }
});

test("Student ID plus OTP uses the trusted server email and discloses no pre-auth email", async () => {
  const h = harness("resolve-student-login", { students: [{ ...student, status: "pending", auth_user_id: null }] });
  assert.deepEqual((await h.invoke(setup)).body, { data: { verification_requested: true, delivery_confirmed: false, retry_after_seconds: 60 } });
  const result = await h.invoke(verification);
  assert.equal(result.status, 200);
  assert.deepEqual(h.events.find(e => e.kind === "verifyOtp").data, { email: student.email, token: verification.verification_code, type: "email" });
  assert.equal(result.body.data.student_details.email, student.email);
  assert.equal(result.body.data.student_details.details_verified, true);
  assert.equal(result.body.data.student_details.account_state, "pending");
  assert.ok(!h.events.some(e => e.kind === "passwordUpdate" || e.data?.operation === "update"));
});

test("OTP request waits for Auth dispatch; every eligibility/delivery outcome stays a neutral acknowledgement", async () => {
  let release;
  const dispatchWait = new Promise(resolve => { release = resolve; });
  const h = harness("resolve-student-login", { dispatchWait });
  let completed = false;
  const request = h.invoke(setup).then(result => { completed = true; return result; });
  for (let n = 0; n < 100 && !h.events.some(e => e.kind === "sendOtp"); n++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(h.events.some(e => e.kind === "sendOtp"));
  assert.equal(completed, false);
  release();
  const normal = await request;
  for (const options of [{ sendError: true }, { sendError: true, sendStatus: 429 }, { sendThrows: true }, { students: [] }]) {
    const failed = harness("resolve-student-login", options);
    const response = await failed.invoke(setup);
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, normal.body);
    assert.equal(response.body.data.delivery_confirmed, false);
  }
});

test("setup HMAC cooldown applies to unknown and known IDs without SMTP or eligibility checks", async () => {
  for (const students of [[], [student]]) {
    const h = harness("resolve-student-login", { rateAllowed: false, students });
    const response = await h.invoke(setup);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "900");
    assert.deepEqual(h.events.map(e => e.kind), ["rate"]);
  }
});

test("invalid OTP payloads never substitute a valid six-zero code or reach Auth", async () => {
  for (const code of [undefined, null, "", "12", "abcdef", 123456]) {
    const h = harness();
    assert.equal((await h.invoke({ ...verification, verification_code: code })).status, 401);
    assert.ok(!h.events.some(e => e.kind === "verifyOtp"));
  }
});

test("linking requires a valid, confirmed and matching Auth identity before password or student writes", async () => {
  for (const options of [
    { invalidSession: true }, { user: { ...verifiedUser, email_confirmed_at: null } },
    { user: { ...verifiedUser, email: "untrusted@example.invalid" } },
    { user: { ...verifiedUser, id: "foreign-auth" } },
    { admins: [{ id: 1, auth_user_id: verifiedUser.id, email: student.email }] },
  ]) {
    const h = harness("link-student-identity", options);
    assert.ok([401, 403].includes((await h.invoke(linking, authorized)).status));
    assert.ok(!h.events.some((e) => e.kind === "passwordUpdate" || e.data?.operation === "update"));
  }
  const anonymous = harness("link-student-identity");
  assert.equal((await anonymous.invoke(linking)).status, 401);
  assert.equal(anonymous.events.length, 0);
});

test("successful verified setup sets the password before linking and activating the pending synthetic record", async () => {
  const h = harness("link-student-identity", { students: [{ ...student, status: "pending", auth_user_id: null }] });
  const result = await h.invoke(linking, authorized);
  assert.equal(result.status, 200);
  assert.equal(result.body.linked, true);
  assert.equal(h.db.students[0].status, "active");
  assert.equal(h.db.students[0].auth_user_id, verifiedUser.id);
  assert.ok(h.events.findIndex((e) => e.kind === "passwordUpdate") < h.events.findIndex((e) => e.data?.operation === "update"));
});

test("invalid passwords, password service failures and database failures cannot activate pending students", async () => {
  for (const [options, payload] of [
    [{}, { ...linking, password: "weak" }], [{ passwordUpdateError: true }, linking], [{ databaseError: true }, linking],
    [{ passwordUpdateThrows: true }, linking],
    [{ passwordResponseUser: { ...verifiedUser, id: "foreign" } }, linking],
    [{ passwordResponseUser: { ...verifiedUser, email_confirmed_at: null } }, linking],
  ]) {
    const pendingStudent = { ...student, status: "pending", auth_user_id: null };
    const h = harness("link-student-identity", { ...options, students: [pendingStudent] });
    assert.ok((await h.invoke(payload, authorized)).status >= 400);
    assert.deepEqual(h.db.students, [pendingStudent]);
    assert.ok(!h.events.some((e) => e.data?.operation === "update"));
  }
});

test("Student ID inspection has identical protected output for known, absent, disabled and pending identities", async () => {
  let baseline;
  for (const students of [[student], [], [{ ...student, status: "disabled" }], [{ ...student, status: "pending", auth_user_id: null }]]) {
    const h = harness("resolve-student-login", { students });
    const result = await h.invoke({ action: "inspect_setup", student_number: student.student_number });
    assert.equal(result.status, 200);
    if (baseline) assert.deepEqual(result.body, baseline);
    baseline = result.body;
    assert.equal(result.body.data.student_details.details_verified, false);
    assert.ok(!JSON.stringify(result.body).includes(student.email));
    assert.ok(h.events.some(e => e.kind === "rate" && e.data.args.p_operation === "verify"));
    assert.ok(!h.events.some(e => ["sendOtp", "createUser", "verifyOtp", "passwordUpdate"].includes(e.kind)));
  }
});

const inspectDeployment = "resolve-student-login-inspect-deploy";
const inspection = { action: "inspect_setup", student_number: student.student_number };

test("minimal deployment inspection is identical for eligible, unknown, active, disabled and ambiguous records", async () => {
  const expected = { data: { verification_required: true, student_details: {
    student_number: student.student_number, details_verified: false,
    first_name: null, last_name: null, email: null, program: null, year_level: null,
  } } };
  for (const students of [
    [{ ...student, status: "pending", auth_user_id: null }], [], [student],
    [{ ...student, status: "disabled" }], [student, { ...student, id: 99 }],
  ]) {
    const h = harness(inspectDeployment, { students });
    const before = structuredClone(h.db);
    // An untrusted bearer header never authorizes identity disclosure.
    const result = await h.invoke(inspection, { Authorization: "Bearer synthetic-invalid" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, expected);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), "http://localhost:5174");
    assert.deepEqual(h.db, before);
    assert.deepEqual(h.events.map(event => event.kind), ["rate"]);
    assert.equal(h.events[0].data.args.p_operation, "verify");
    assert.deepEqual(h.logs, []);
  }
});

test("minimal inspection rejects malformed and forged requests before any service access", async () => {
  for (const payload of [
    null, [], { action: "inspect_setup" }, { ...inspection, student_number: "" },
    { ...inspection, student_number: 12345 }, { ...inspection, student_number: "12x45" },
    { ...inspection, student_number: "1".repeat(21) },
    { ...inspection, email: student.email }, { ...inspection, student_id: student.id },
    { ...inspection, auth_user_id: student.auth_user_id }, { ...inspection, organization_id: 2 },
    { ...inspection, action: "inspect_setup_admin" },
  ]) {
    const h = harness(inspectDeployment);
    assert.equal((await h.invoke(payload)).status, 401);
    assert.equal(h.events.length, 0);
  }
  for (const origin of [null, "https://hostile.invalid"]) {
    const h = harness(inspectDeployment);
    assert.equal((await h.invoke(inspection, { Origin: origin })).status, 403);
    assert.equal(h.events.length, 0);
  }
  for (const requestOptions of [{ rawBody: "{" }, { rawBody: "x".repeat(8193) }, { method: "GET" }]) {
    const h = harness(inspectDeployment);
    assert.equal((await h.invoke(inspection, {}, requestOptions)).status, requestOptions.method === "GET" ? 403 : 401);
    assert.equal(h.events.length, 0);
  }
});

test("minimal inspection preserves rate-limit and configuration failures without student disclosure", async () => {
  for (const [options, headers, status, events] of [
    [{ rateAllowed: false }, {}, 429, ["rate"]],
    [{ rateError: true }, {}, 429, ["rate"]],
    [{ rateThrows: true }, {}, 503, ["rate"]],
    [{ env: { STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: "short" } }, {}, 503, []],
    [{}, { "cf-connecting-ip": null }, 503, []],
  ]) {
    const h = harness(inspectDeployment, options);
    const result = await h.invoke(inspection, headers);
    assert.equal(result.status, status);
    assert.deepEqual(h.events.map(event => event.kind), events);
    assert.equal(result.body.data?.student_details, undefined);
    assert.ok(!JSON.stringify(result.body).includes(student.email));
  }
});

test("minimal deployment leaves all v7 login, email dispatch and OTP verification outcomes unchanged", async () => {
  const cases = [
    [credentials, {}], [credentials, { students: [] }],
    [credentials, { students: [{ ...student, status: "pending", auth_user_id: null }] }],
    [credentials, { students: [{ ...student, status: "disabled" }] }],
    [credentials, { badPassword: true }], [credentials, { signInUserId: "foreign" }],
    [credentials, { rateAllowed: false }], [credentials, { databaseError: true }],
    [setup, {}], [setup, { students: [], authUsers: [] }],
    [setup, { students: [{ ...student, status: "pending", auth_user_id: null }], authUsers: [] }],
    [setup, { students: [{ ...student, status: "pending", auth_user_id: null }] }],
    [setup, { admins: [{ auth_user_id: student.auth_user_id }] }],
    [setup, { sendError: true }], [setup, { sendThrows: true }],
    [verification, {}], [verification, { invalidOtp: true }],
    [verification, { verifiedUserId: "foreign" }],
    [verification, { otpUser: { ...verifiedUser, email_confirmed_at: null } }],
    [{ ...verification, registered_email: "foreign@example.invalid" }, {}],
    [{ ...verification, verification_code: "bad" }, {}],
  ];
  for (const [payload, options] of cases) {
    const baseline = harness("resolver-v7-baseline", options);
    const prepared = harness(inspectDeployment, options);
    const before = await baseline.invoke(payload);
    const after = await prepared.invoke(payload);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.body, before.body);
    const normalizeEvents = events => events.map(event => event.kind === "delay" ? { kind: "delay" } : event);
    assert.deepEqual(normalizeEvents(prepared.events), normalizeEvents(baseline.events));
    assert.deepEqual(prepared.db, baseline.db);
  }
});

test("new frontend refuses the historical protected v8 response until recognition deployment", async () => {
  const source = (await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8"));
  const inspectSource = source.slice(source.indexOf("export async function inspectStudentSetup"), source.indexOf("export async function verifyStudentAccessCode")).replace("export ", "");
  const h = harness(inspectDeployment);
  const context = {
    readStudentSetupRecognition,
    RESOLVE_STUDENT_LOGIN_FUNCTION: "resolve-student-login",
    supabase: { functions: { async invoke(name, { body }) {
      assert.equal(name, "resolve-student-login");
      assert.deepEqual(JSON.parse(JSON.stringify(body)), inspection);
      const result = await h.invoke(body);
      return { data: result.body, error: null };
    } } },
  };
  runInNewContext(inspectSource + "\nglobalThis.inspect = inspectStudentSetup;", context);
  const result = await context.inspect({ studentNumber: student.student_number });
  assert.ok(result.error);
  assert.equal(result.data, null);
  assert.deepEqual(h.events.map(event => event.kind), ["rate"]);
});

test("failed OTP cannot disclose student details or enrollment history", async () => {
  const h = harness("resolve-student-login", { invalidOtp: true });
  const result = await h.invoke(verification);
  assert.equal(result.status, 401);
  assert.equal(result.body.data.student_details, undefined);
  assert.ok(!h.events.some(e => e.kind === "table" && e.data.table === "student_term_enrollments"));
});

test("verified active accounts are identified without password or identity mutations", async () => {
  const h = harness();
  const result = await h.invoke(verification);
  assert.equal(result.body.data.student_details.account_state, "active");
  assert.equal(result.body.data.student_details.enrollments.length, 1);
  assert.ok(!h.events.some(e => e.kind === "passwordUpdate" || e.data?.operation === "update"));
});

test("read-only profile artifact returns only the verified caller's safe active profile", async () => {
  const h = harness("student-profile-readonly-deploy", { students: [{ ...student, password: "synthetic-not-returned", private_notes: "hidden" }] });
  const result = await h.invoke({ action: "profile" }, authorized);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.student_number, student.student_number);
  assert.equal(result.body.data.role, "student");
  for (const field of ["auth_user_id", "password", "private_notes"]) assert.equal(Object.hasOwn(result.body.data, field), false);
  assert.ok(!h.events.some(e => e.data?.operation === "update" || e.kind === "passwordUpdate"));
});

test("read-only profile denies anonymous, invalid, unconfirmed, foreign, disabled and ambiguous identities", async () => {
  assert.equal((await harness("student-profile-readonly-deploy").invoke({ action: "profile" })).status, 401);
  for (const options of [
    { invalidSession: true }, { user: { ...verifiedUser, email_confirmed_at: null } },
    { user: { ...verifiedUser, id: "foreign-auth" } },
    { students: [{ ...student, status: "pending" }] },
    { students: [student, { ...student, id: 99 }] },
    { user: { ...verifiedUser, email: "foreign@example.invalid" } },
  ]) {
    const h = harness("student-profile-readonly-deploy", options);
    const result = await h.invoke({ action: "profile" }, authorized);
    assert.ok([401, 403].includes(result.status));
    assert.ok(!h.events.some(e => e.data?.operation === "update"));
  }
});

test("read-only profile rejects mutation actions, forged student/scope identifiers and unavailable data", async () => {
  for (const body of [{ action: "update_photo" }, { action: "profile", student_id: 99 }, { action: "profile", organization_id: 99 }]) {
    const h = harness("student-profile-readonly-deploy");
    assert.equal((await h.invoke(body, authorized)).status, 400);
    assert.equal(h.events.length, 0);
  }
  assert.equal((await harness("student-profile-readonly-deploy", { databaseError: true }).invoke({ action: "profile" }, authorized)).status, 503);
});
