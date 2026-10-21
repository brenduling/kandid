import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight,
  rejectDisallowedOrigin, withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

// These sources were compared read-only with production v8/v7/v6. No live Auth,
// HTTP, email, rate-limit or account mutation is performed by this test suite.
const contracts = {
  resolver: ["resolve-student-login-inspect-deploy", "e79d6efef161760868445c1e54012c08f548ca59f09d2309293a1b9209d13c9a"],
  profile: ["student-profile-readonly-deploy", "42976c3282c5102624a322e7c5b8e03d236eff0e2089089805069f775eca7e6a"],
  linker: ["link-student-identity", "d1939e0fe322df33768a863932c749af9c5bba0fd2d04eb6d705cd2f7060f606"],
};
const sources = Object.fromEntries(Object.entries(contracts).map(([key, [directory]]) => [
  key, readFileSync(`supabase/functions/${directory}/index.ts`, "utf8").replace(/\r\n/g, "\n"),
]));
const record = {
  id: 42, student_number: "700001", status: "pending", auth_user_id: null,
  first_name: "Synthetic", last_name: "Student", email: "student@example.invalid",
  program: "BSIT", year_level: 1, private_notes: "Never disclose",
};
const verifiedUser = { id: "synthetic-auth", email: record.email, email_confirmed_at: "2026-10-17T00:00:00Z" };
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 };
const bearer = { Authorization: "Bearer synthetic-session" };

function harness(name, options = {}) {
  const events = [];
  const students = structuredClone(options.students ?? [record]);
  const user = { ...verifiedUser, ...options.user };
  let handler;
  const env = {
    SUPABASE_URL: "https://synthetic.invalid", SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET: "x".repeat(48),
  };
  const admin = {
    async rpc(name) { events.push(`rpc:${name}`); return { data: true, error: null }; },
    from(table) {
      assert.equal(table, "students", "no enrollment/organization lookup is available before recognition");
      const filters = [];
      let limit = Infinity;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        limit(value) { limit = value; return query; },
        update() { throw Error("Business writes prohibited in recognition tests"); },
        then(resolve, reject) {
          events.push(`read:${table}`);
          return Promise.resolve({ data: students.filter(row => filters.every(filter => filter(row))).slice(0, limit), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const auth = { auth: {
    async getUser() {
      events.push("getUser");
      return { data: { user: options.invalidSession ? null : user }, error: options.invalidSession ? Error("Synthetic invalid session") : null };
    },
    async verifyOtp(payload) {
      events.push("verifyOtp");
      return options.invalidOtp || payload.email !== user.email
        ? { data: { session: null, user: null }, error: Error("Synthetic invalid OTP") }
        : { data: { session, user }, error: null };
    },
  } };
  runInNewContext(stripTypeScriptTypes(sources[name]).replace(/^import .*;\n/gm, ""), {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto: webcrypto,
    KANDID_WEB_ORIGINS, corsHeaders, handleCorsPreflight, rejectDisallowedOrigin,
    serveWithKandidCors(fn) { handler = async request => withKandidCors(request, await fn(request)); },
    Deno: { env: { get: key => env[key] }, serve(fn) { handler = fn; } },
    createClient(url, key) { assert.equal(url, env.SUPABASE_URL); return key === env.SUPABASE_SERVICE_ROLE_KEY ? admin : auth; },
    fetch() { throw Error("External HTTP/password mutation prohibited"); },
    console: { warn() {}, error() {} }, setTimeout(callback) { callback(); },
  });
  return {
    students, events,
    async invoke(payload, headers = {}) {
      const response = await handler(new Request("https://synthetic.invalid", {
        method: "POST", headers: { Origin: "http://localhost:5174", "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.10", ...headers },
        body: JSON.stringify(payload),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("readiness checks use the exact deployed-matching source contracts", () => {
  for (const [name, [, hash]] of Object.entries(contracts)) {
    assert.equal(createHash("sha256").update(sources[name]).digest("hex"), hash);
  }
});

test("pre-email account recognition remains private and independent of Student ID existence", async () => {
  let baseline;
  for (const students of [[record], [], [{ ...record, status: "disabled" }]]) {
    const h = harness("resolver", { students });
    const result = await h.invoke({ action: "inspect_setup", student_number: record.student_number });
    assert.equal(result.status, 200);
    if (baseline) assert.deepEqual(result.body, baseline);
    baseline = result.body;
    assert.equal(result.body.data.student_details.details_verified, false);
    for (const field of ["first_name", "last_name", "email", "program", "year_level"]) assert.equal(result.body.data.student_details[field], null);
    assert.deepEqual(h.events, ["rpc:kandid_consume_student_auth_rate_limit"]);
  }
});

test("v8 OTP can precede password creation but returns no authorized account-recognition payload", async () => {
  for (const student of [record, { ...record, status: "active", auth_user_id: verifiedUser.id }]) {
    const h = harness("resolver", { students: [student] });
    const result = await h.invoke({ action: "verify_access", student_number: record.student_number, verification_code: "000000" });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.authenticated, true);
    assert.equal(result.body.data.session.access_token, session.access_token);
    assert.equal(result.body.data.student_details, undefined);
    assert.deepEqual(h.students, [student]);
    assert.deepEqual(h.events, ["rpc:kandid_consume_student_auth_rate_limit", "read:students", "verifyOtp"]);
  }
});

test("bad, unconfirmed, unknown, disabled and foreign OTP identities cannot disclose account details", async () => {
  for (const options of [
    { invalidOtp: true }, { user: { email_confirmed_at: null } }, { students: [] },
    { students: [{ ...record, status: "disabled" }] },
    { students: [{ ...record, status: "active", auth_user_id: "foreign-auth" }] },
  ]) {
    const h = harness("resolver", options);
    const result = await h.invoke({ action: "verify_access", student_number: record.student_number, verification_code: "000000" });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { data: { authenticated: false } });
  }
});

test("a confirmed email session cannot unlock an unlinked or pending Student profile", async () => {
  for (const students of [[record], [{ ...record, auth_user_id: verifiedUser.id }]]) {
    const h = harness("profile", { students });
    const result = await h.invoke({ action: "profile" }, bearer);
    assert.equal(result.status, 403);
    assert.equal(result.body.data, undefined);
    assert.deepEqual(h.students, students);
  }
});

test("anonymous, invalid and unconfirmed sessions cannot obtain a profile", async () => {
  assert.equal((await harness("profile").invoke({ action: "profile" })).status, 401);
  for (const options of [{ invalidSession: true }, { user: { email_confirmed_at: null } }]) {
    const h = harness("profile", options);
    const result = await h.invoke({ action: "profile" }, bearer);
    assert.equal(result.status, 401);
    assert.equal(result.body.data, undefined);
    assert.ok(!h.events.includes("read:students"));
  }
});

test("linker cannot serve as a read-only recognition operation without a valid password", async () => {
  for (const password of [undefined, "", "weak"]) {
    const h = harness("linker");
    const result = await h.invoke({ student_number: record.student_number, setup_mode: true, password }, bearer);
    assert.equal(result.status, 403);
    assert.equal(result.body.student, undefined);
    assert.deepEqual(h.students, [record]);
    assert.deepEqual(h.events, ["getUser"]);
  }
});

test("existing active-profile recognition remains scoped and excludes private implementation fields", async () => {
  const h = harness("profile", { students: [{ ...record, status: "active", auth_user_id: verifiedUser.id }] });
  const result = await h.invoke({ action: "profile" }, bearer);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.first_name, record.first_name);
  assert.equal(result.body.data.email, record.email);
  assert.equal(result.body.data.private_notes, undefined);
  assert.equal(result.body.data.auth_user_id, undefined);
});
