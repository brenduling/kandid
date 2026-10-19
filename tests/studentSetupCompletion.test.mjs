import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";

const source = (await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/import\.meta\.env/g, "testEnvironment")
  .replace(/^export /gm, "");
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
const student = { id: 42, student_number: "700001", status: "active" };

test("a stateless bearer header is not an Auth SDK session for password updates", async () => {
  let requests = 0;
  const client = createClient("http://127.0.0.1:1", "synthetic-anon", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer synthetic" }, fetch() { requests++; throw new Error("No networking permitted"); } },
  });
  const result = await client.auth.updateUser({ password: "Synthetic!123" });
  assert.equal(result.error?.name, "AuthSessionMissingError");
  assert.equal(requests, 0);
});
function harness(options = {}) {
  const events = [];
  const supabase = {
    functions: {
      async invoke(name, { body }) {
        events.push({ kind: "invoke", name, body });
        if (options.invokeError) return { data: null, error: options.invokeError };
        if (name === "resolve-student-login") return { data: { data: { authenticated: true, session } }, error: null };
        assert.equal(name, "link-student-identity", "setup never relies on the separate profile endpoint");
        return { data: options.linkResponse || { linked: true, student }, error: null };
      },
    },
    auth: {
      async setSession(value) {
        events.push({ kind: "session", value });
        return { data: { session }, error: options.sessionError || null };
      },
      async getUser() {
        events.push({ kind: "identity" });
        return { data: { user: { id: "synthetic-auth", email_confirmed_at: options.unconfirmed ? null : "2026-10-17T00:00:00Z" } }, error: options.identityError || null };
      },
      async signOut(value) { events.push({ kind: "signOut", value }); return { error: options.signOutError || null }; },
    },
  };
  const storage = { removeItem() {}, getItem() { return null; } };
  const context = {
    supabase, testEnvironment: {}, clearSessionCache() { events.push({ kind: "clearCache" }); },
    localStorage: storage, sessionStorage: storage,
    window: { dispatchEvent() {} }, CustomEvent: class {},
  };
  runInNewContext(source + "\nglobalThis.api = { verifyStudentAccessCode, linkCurrentStudentIdentity, signOutStudentSetupSession };", context);
  return { api: context.api, events };
}

test("verification sends only Student ID/code, establishes the returned session and confirms Auth identity", async () => {
  const h = harness();
  const result = await h.api.verifyStudentAccessCode({ studentNumber: student.student_number, code: "012345", email: "ignored@example.invalid" });
  assert.equal(result.error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(h.events[0].body)), { action: "verify_access", student_number: student.student_number, verification_code: "012345" });
  assert.deepEqual(h.events.map(e => e.kind), ["invoke", "session", "identity"]);
});

test("invalid or unconfirmed sessions cannot report successful OTP verification", async () => {
  for (const options of [{ sessionError: new Error("Synthetic session failure") }, { identityError: new Error("Synthetic expired session") }, { unconfirmed: true }]) {
    const h = harness(options);
    const result = await h.api.verifyStudentAccessCode({ studentNumber: student.student_number, code: "012345" });
    assert.ok(result.error);
    assert.ok(!h.events.some(e => e.name === "link-student-identity"));
  }
});

test("OTP rejection and rate-limit status reach the UI without establishing a session", async () => {
  for (const status of [401, 429, 503]) {
    const error = { context: { status } };
    const h = harness({ invokeError: error });
    assert.equal((await h.api.verifyStudentAccessCode({ studentNumber: student.student_number, code: "012345" })).error, error);
    assert.deepEqual(h.events.map(e => e.kind), ["invoke"]);
  }
});

test("completion trusts only explicit server confirmation of the requested active Student", async () => {
  for (const linkResponse of [
    { linked: false, student }, { linked: true },
    { linked: true, student: { ...student, student_number: "another-student" } },
    { linked: true, student: { ...student, status: "pending" } },
  ]) {
    const h = harness({ linkResponse });
    assert.ok((await h.api.linkCurrentStudentIdentity({ studentNumber: student.student_number, setupMode: true, password: "Synthetic!123" })).error);
  }
  const h = harness();
  const result = await h.api.linkCurrentStudentIdentity({ studentNumber: student.student_number, setupMode: true, password: "Synthetic!123" });
  assert.equal(result.error, null);
  assert.equal(result.data, student);
  assert.equal(h.events.length, 1, "server confirmation is not replaced by a separate profile lookup");
  assert.equal(h.events[0].body.setup_mode, true);
  assert.equal(h.events[0].body.password, "Synthetic!123");
});

test("Proceed to Login closes only the setup session and reports logout failure", async () => {
  const h = harness();
  assert.equal((await h.api.signOutStudentSetupSession()).error, null);
  assert.equal(h.events[0].kind, "signOut");
  assert.equal(h.events[0].value.scope, "local");
  assert.ok(h.events.some(e => e.kind === "clearCache"));
  const failed = harness({ signOutError: new Error("Synthetic logout failure") });
  assert.ok((await failed.api.signOutStudentSetupSession()).error);
  assert.ok(!failed.events.some(e => e.kind === "clearCache"));
});
