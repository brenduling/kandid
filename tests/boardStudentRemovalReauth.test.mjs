import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as membershipAdmission from "../supabase/functions/_shared/membershipAdmission.js";
import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const BOARD_FUNCTION = "supabase/functions/board-manual-enrollment/index.ts";
const BOARD_UTILS = "src/utils/boardManualEnrollment.js";

const CORRECT_PASSWORD = "correct-horse-battery";
const STUDENT_NUMBER = "40212";

function fixture() {
  return {
    userId: "board-auth",
    userEmail: "board.officer@psits.test",
    // Password the fake Supabase Auth will accept for userEmail.
    validPassword: CORRECT_PASSWORD,
    // Every signInWithPassword call the function makes, for assertions.
    signInAttempts: [],
    profiles: [
      {
        id: 9,
        auth_user_id: "board-auth",
        email: "board.officer@psits.test",
        role: "electoral_board",
        status: "active",
        organization_id: 7,
      },
    ],
    terms: [{ id: 5, status: "active", academic_year: "2026-2027", semester: "1st Semester" }],
    organizations: [{ id: 7, name: "PSITS", organization_type: "non_departmental", membership_scope: "manual" }],
    students: [
      {
        id: 1,
        auth_user_id: "student-auth",
        status: "active",
        student_number: STUDENT_NUMBER,
        first_name: "Rene",
        last_name: "Marques",
        program: "BSIT",
        year_level: 3,
      },
    ],
    participations: [
      { id: 70, student_id: 1, organization_id: 7, academic_term_id: 5, status: "active" },
    ],
    enrollments: [{ student_id: 1, academic_term_id: 5, enrollment_status: "enrolled" }],
    rpcCalls: [],
    rpcResult: null,
    rpcError: null,
    admissionResult: [{ allowed: true, reason: "ALLOWED", target_organization_type: "departmental", academic_term_id: 5 }],
    audits: [],
    updates: [],
  };
}

function matching(rows, filters) {
  return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
}

function mockQuery(table, state) {
  const tables = {
    admin_users: state.profiles,
    academic_terms: state.terms,
    students: state.students,
    student_organization_terms: state.participations,
    student_term_enrollments: state.enrollments,
    organizations: state.organizations,
  };
  const filters = {};
  let update = null;
  const query = {
    select() { return query; },
    eq(key, value) { filters[key] = value; return query; },
    order() { return query; },
    limit() { return query; },
    update(changes) { update = changes; return query; },
    insert(row) { state.audits.push(row); return Promise.resolve({ error: null }); },
    async maybeSingle() {
      const row = matching(tables[table] || [], filters)[0] || null;
      if (row && update) {
        Object.assign(row, update);
        state.updates.push({ table, changes: update });
      }
      return { data: row, error: null };
    },
    then(resolve, reject) {
      const rows = matching(tables[table] || [], filters);
      return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject);
    },
  };
  return query;
}

// The anon client is the ONLY place a password may be presented. It stands in for
// Supabase Auth (GoTrue): it accepts the fixture password for the board email and
// rejects everything else, and it records attempts so tests can prove what was sent.
function createAuthClient(state, { authenticated }) {
  return {
    auth: {
      getUser: async () => {
        if (!authenticated) return { data: { user: null }, error: { message: "invalid" } };
        if (state.sessionValid === false) return { data: { user: null }, error: { message: "expired" } };
        return { data: { user: { id: state.userId, email: state.userEmail } }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        state.signInAttempts.push({ email, password });
        if (state.authUnavailable) return { data: { user: null }, error: { message: "auth unavailable" } };
        const ok = email === state.userEmail && password === state.validPassword;
        if (!ok) return { data: { user: null }, error: { message: "invalid login credentials" } };
        return { data: { user: { id: state.userId }, session: { access_token: "issued" } }, error: null };
      },
    },
  };
}

function loadHandler(state, options = {}) {
  let handler;
  const source = readFileSync(BOARD_FUNCTION, "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const createClient = (_url, key) => {
    if (key === "anon") {
      return {
        ...createAuthClient(state, { authenticated: options.authenticated !== false }),
        from: (table) => mockQuery(table, state),
      };
    }
    return {
      from: (table) => mockQuery(table, state),
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        if (name === "kandid_check_student_organization_admission") {
          return { data: state.admissionResult, error: null };
        }
        if (state.rpcError) return { data: null, error: state.rpcError };
        if (name !== "board_update_student_participation") {
          throw new Error(`Unexpected RPC: ${name}`);
        }
        if (state.rpcResult) return { data: state.rpcResult, error: null };
        return {
          data: [{ status: "removed", already_applied: false, student_number: STUDENT_NUMBER }],
          error: null,
        };
      },
    };
  };
  vm.runInNewContext(compiled, {
    require: (specifier) => specifier.includes("membershipAdmission")
      ? membershipAdmission
      : specifier.includes("kandidProductionSecurity")
      ? {
        handleCorsPreflight,
        rejectDisallowedOrigin,
        serveWithKandidCors: (handlerFn) => {
          handler = async (request) => withKandidCors(request, await handlerFn(request));
        },
      }
      : ({ createClient }),
    module: { exports: {} },
    exports: {},
    Deno: {
      env: {
        get: (key) =>
          ({ SUPABASE_URL: "url", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" })[key],
      },
      serve: (value) => { handler = value; },
    },
    Request,
    Response,
    console,
  }, { filename: BOARD_FUNCTION });
  return handler;
}

async function call(handler, body, options = {}) {
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: options.authenticated === false ? {} : { Authorization: "Bearer test" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

function removeBody(overrides = {}) {
  return {
    action: "remove_student_participation",
    student_id: 1,
    reason: "Incorrect organization assignment",
    confirm_student_number: STUDENT_NUMBER,
    password: CORRECT_PASSWORD,
    ...overrides,
  };
}

function mutationCount(state) {
  return state.rpcCalls.filter((call) => call.name === "board_update_student_participation").length;
}

// 1. Correct Student ID + correct Board password -> removal permitted.
test("removal is permitted only when the Student ID and Board password both verify", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 200);
  assert.equal(result.body.data.already_applied, false);
  assert.equal(mutationCount(state), 1);

  // The trusted RPC still receives server-derived org and actor, never client input.
  const args = state.rpcCalls[0].args;
  assert.equal(args.target_organization_id, 7);
  assert.equal(args.actor_admin_id, 9);
  assert.equal(args.target_student_id, 1);
  assert.equal(args.target_action, "remove");
  assert.equal(state.participations[0].status, "active");
});

// 2. Wrong Student ID + correct password -> rejected, no mutation.
test("a wrong Student ID is rejected before any password check or mutation", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), removeBody({ confirm_student_number: "99999" }));

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "The Student ID does not match the selected student.");
  assert.equal(mutationCount(state), 0);
  assert.equal(state.signInAttempts.length, 0);
});

// 3. Correct Student ID + wrong password -> rejected, no mutation.
test("a wrong Board password is rejected with no participation mutation", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), removeBody({ password: "not-my-password" }));

  assert.equal(result.status, 401);
  assert.equal(result.body.error, "Your password could not be verified.");
  assert.equal(result.body.code, "password_invalid");
  assert.equal(mutationCount(state), 0);
  assert.equal(state.participations[0].status, "active");
});

// 4. Both wrong -> rejected, no mutation.
test("a wrong Student ID and wrong password together are rejected with no mutation", async () => {
  const state = fixture();
  const result = await call(
    loadHandler(state),
    removeBody({ confirm_student_number: "11111", password: "not-my-password" }),
  );

  assert.equal(result.status, 400);
  assert.equal(mutationCount(state), 0);
  assert.equal(state.signInAttempts.length, 0);
  assert.equal(state.participations[0].status, "active");
});

// 5. Expired / invalid JWT -> rejected.
test("an expired or invalid Board session is rejected before any verification", async () => {
  const state = fixture();
  state.sessionValid = false;
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 401);
  assert.equal(result.body.code, "session_invalid");
  assert.equal(mutationCount(state), 0);

  const missing = await call(loadHandler(fixture()), removeBody(), { authenticated: false });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, "session_invalid");
});

// 6. Authenticated non-Board user -> rejected.
test("an authenticated non-Board user cannot remove a student", async () => {
  for (const mutate of [
    (state) => { state.profiles[0].role = "super_admin"; },
    (state) => { state.profiles[0].role = "student"; },
    (state) => { state.profiles[0].status = "disabled"; },
    (state) => { state.profiles[0].auth_user_id = "someone-else"; },
  ]) {
    const state = fixture();
    mutate(state);
    const result = await call(loadHandler(state), removeBody());

    assert.equal(result.status, 403);
    assert.equal(result.body.code, "board_forbidden");
    assert.equal(mutationCount(state), 0);
    assert.equal(state.signInAttempts.length, 0);
  }
});

// 7. Board user targeting a student outside the assigned organization -> rejected.
test("a Board user cannot remove a student outside their assigned organization", async () => {
  const state = fixture();
  state.participations[0].organization_id = 8;
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "target_out_of_scope");
  assert.equal(mutationCount(state), 0);
  assert.equal(state.signInAttempts.length, 0);
});

// 7b. Historical participation in a previous term is not a valid target.
test("historical participation in an earlier term is rejected as a removal target", async () => {
  const state = fixture();
  state.participations[0].academic_term_id = 4;
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 403);
  assert.equal(mutationCount(state), 0);
});

// 8. Already removed target -> safe existing idempotent behaviour is preserved.
test("an already removed target keeps the existing idempotent response", async () => {
  const state = fixture();
  state.participations[0].status = "removed";
  state.rpcResult = [{ status: "removed", already_applied: true, student_number: STUDENT_NUMBER }];

  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 200);
  assert.equal(result.body.data.already_applied, true);
  assert.equal(mutationCount(state), 1);
});

// 9. Password absent -> rejected.
test("an absent password is rejected with no mutation", async () => {
  for (const overrides of [{ password: undefined }, { password: "" }, { password: 12345 }]) {
    const state = fixture();
    const body = removeBody(overrides);
    if (overrides.password === undefined) delete body.password;
    const result = await call(loadHandler(state), body);

    assert.equal(result.status, 401, JSON.stringify(overrides));
    assert.equal(result.body.code, "password_invalid");
    assert.equal(mutationCount(state), 0);
  }
});

// 10. Student ID confirmation absent -> rejected.
test("an absent Student ID confirmation is rejected with no mutation", async () => {
  for (const value of [undefined, "", "   "]) {
    const state = fixture();
    const body = removeBody();
    if (value === undefined) delete body.confirm_student_number;
    else body.confirm_student_number = value;

    const result = await call(loadHandler(state), body);
    assert.equal(result.status, 400, JSON.stringify(value));
    assert.equal(result.body.code, "confirmation_required");
    assert.equal(mutationCount(state), 0);
    assert.equal(state.signInAttempts.length, 0);
  }
});

// 11. Successful removal audit contains no password or credential material.
test("a successful removal audit records no password or credential material", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), removeBody());
  assert.equal(result.status, 200);

  const serialized = JSON.stringify({
    response: result.body,
    rpcArgs: state.rpcCalls[0].args,
    audits: state.audits,
    participation: state.participations[0],
  });

  assert.ok(!serialized.includes(CORRECT_PASSWORD), "password must never be echoed or stored");
  assert.ok(!/"password"/i.test(serialized), "no password field may be persisted");
  assert.ok(!serialized.includes("issued"), "issued auth session must not be returned");
});

// 12. Failed authentication performs no participation mutation.
test("failed authentication never reaches the participation mutation", async () => {
  const failures = [
    { password: "wrong" },
    { confirm_student_number: "00000" },
    { password: "wrong", confirm_student_number: "00000" },
  ];

  for (const overrides of failures) {
    const state = fixture();
    const result = await call(loadHandler(state), removeBody(overrides));

    assert.ok(result.status >= 400, JSON.stringify(overrides));
    assert.equal(mutationCount(state), 0, JSON.stringify(overrides));
    assert.equal(state.updates.length, 0, JSON.stringify(overrides));
    assert.equal(state.participations[0].status, "active", JSON.stringify(overrides));
  }
});

// 12b. An unavailable auth service fails closed rather than skipping verification.
test("an unavailable Supabase Auth service fails closed", async () => {
  const state = fixture();
  state.authUnavailable = true;
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 401);
  assert.equal(result.body.code, "password_invalid");
  assert.equal(mutationCount(state), 0);
});

// 13. Repeated successful request preserves the existing safe behaviour.
test("a repeated removal request stays safe and idempotent", async () => {
  const state = fixture();
  const handler = loadHandler(state);

  const first = await call(handler, removeBody());
  assert.equal(first.status, 200);
  assert.equal(first.body.data.already_applied, false);

  state.rpcResult = [{ status: "removed", already_applied: true, student_number: STUDENT_NUMBER }];
  state.participations[0].status = "removed";

  const second = await call(handler, removeBody());
  assert.equal(second.status, 200);
  assert.equal(second.body.data.already_applied, true);
  assert.equal(mutationCount(state), 2);
});

// Restore must NOT be gated by the new reauthentication.
test("Board removal and restore reject program-scope participation before the trusted mutation", async () => {
  const state = fixture();
  state.organizations[0].organization_type = "departmental";
  state.organizations[0].membership_scope = "program";
  for (const body of [removeBody(), { action: "restore_student_participation", student_id: 1 }]) {
    const result = await call(loadHandler(state), body);
    assert.equal(result.status, 403);
    assert.equal(result.body.data.outcome, "ACTIVATION_SYNC_REQUIRED");
  }
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.updates.length, 0);
});

test("restore does not require Student ID confirmation or a password", async () => {
  const state = fixture();
  state.participations[0].status = "removed";
  const result = await call(loadHandler(state), {
    action: "restore_student_participation",
    student_id: 1,
  });

  assert.equal(result.status, 200);
  assert.equal(state.signInAttempts.length, 0);
  assert.equal(state.rpcCalls.find((entry) => entry.name === "board_update_student_participation").args.target_action, "restore");
});

test("restore to a non-departmental organization rechecks current enrollment and stays organization-scoped", async () => {
  const state = fixture();
  state.participations[0].status = "removed";
  state.admissionResult = [{
    allowed: true,
    reason: "ALLOWED",
    target_organization_type: "non_departmental",
    academic_term_id: 5,
  }];

  const result = await call(loadHandler(state), {
    action: "restore_student_participation",
    student_id: 1,
  });

  assert.equal(result.status, 200);
  const admissionCall = state.rpcCalls.find((entry) => entry.name === "kandid_check_student_organization_admission");
  assert.equal(admissionCall.args.p_student_id, 1);
  assert.equal(admissionCall.args.p_organization_id, 7);
  assert.equal(admissionCall.args.p_academic_term_id, 5);
  assert.equal(state.rpcCalls.find((entry) => entry.name === "board_update_student_participation").args.target_organization_id, 7);
});

test("restore to a non-departmental organization stays removed when active-term enrollment is gone", async () => {
  const state = fixture();
  state.participations[0].status = "removed";
  state.admissionResult = [{
    allowed: false,
    reason: "NOT_CURRENTLY_ENROLLED",
    target_organization_type: "non_departmental",
    academic_term_id: 5,
  }];

  const result = await call(loadHandler(state), {
    action: "restore_student_participation",
    student_id: 1,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.code, "not_currently_enrolled");
  assert.equal(mutationCount(state), 0);
  assert.equal(state.participations[0].status, "removed");
});

// The submitted Student ID can never redirect the removal to a different student.
test("submitting another valid Student ID cannot change the removal target", async () => {
  const state = fixture();
  state.students.push({
    id: 2,
    auth_user_id: "other",
    status: "active",
    student_number: "55555",
    first_name: "Other",
    last_name: "Student",
  });
  state.participations.push({ id: 71, student_id: 2, organization_id: 7, academic_term_id: 5, status: "active" });

  const result = await call(loadHandler(state), removeBody({ confirm_student_number: "55555" }));

  assert.equal(result.status, 400);
  assert.equal(mutationCount(state), 0);

  // The correct ID still removes only the originally selected target.
  const ok = await call(loadHandler(state), removeBody());
  assert.equal(ok.status, 200);
  assert.equal(state.rpcCalls[0].args.target_student_id, 1);
});

// Smuggled fields are refused on the remove path.
test("the removal request refuses unknown fields", async () => {
  for (const extra of [
    { target_organization_id: 8 },
    { actor_admin_id: 1 },
    { auth_user_id: "someone-else" },
    { board_email: "attacker@evil.test" },
  ]) {
    const state = fixture();
    const result = await call(loadHandler(state), removeBody(extra));

    assert.equal(result.status, 400, JSON.stringify(extra));
    assert.equal(mutationCount(state), 0);
  }
});

// Database and auth internals must never reach the browser.
test("removal failures never leak database or auth internals", async () => {
  const state = fixture();
  state.rpcError = {
    message: 'relation "public.secret_table" does not exist at public.fn(pgcrypto.hmac($1))',
  };
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Student organization participation could not be updated.");
  assert.ok(!JSON.stringify(result.body).includes("pgcrypto"));
  assert.ok(!JSON.stringify(result.body).includes("secret_table"));
});

// A board account with no email on the Auth identity cannot be reauthenticated.
test("a board identity without an email cannot satisfy reauthentication", async () => {
  const state = fixture();
  state.userEmail = null;
  const result = await call(loadHandler(state), removeBody());

  assert.equal(result.status, 401);
  assert.equal(result.body.code, "session_invalid");
  assert.equal(mutationCount(state), 0);
  assert.equal(state.signInAttempts.length, 0);
});

// The password is presented only to the auth client, for the caller's own identity.
test("the submitted password is only ever sent to Supabase Auth for the caller's own email", async () => {
  const state = fixture();
  await call(loadHandler(state), removeBody());

  assert.equal(state.signInAttempts.length, 1);
  assert.equal(state.signInAttempts[0].email, "board.officer@psits.test");
  assert.equal(state.signInAttempts[0].password, CORRECT_PASSWORD);

  const serializedState = JSON.stringify({ rpc: state.rpcCalls, audits: state.audits });
  assert.ok(!serializedState.includes(CORRECT_PASSWORD));
});

// The RPC's own legitimate messages must still reach a Board officer on both paths,
// otherwise sanitising the error would silently hide real, actionable failures.
test("every legitimate participation message is still surfaced, on remove and on restore", async () => {
  const legitimate = [
    "Invalid participation request.",
    "Unsupported participation action.",
    "Removal reason is required.",
    "No active academic term is available.",
    "Student not found.",
    "Organization not found.",
    "Student is not enrolled for the active academic term.",
    "Student does not have current-term participation in this organization.",
  ];

  for (const message of legitimate) {
    for (const body of [removeBody(), { action: "restore_student_participation", student_id: 1 }]) {
      const state = fixture();
      state.rpcError = { message };
      const result = await call(loadHandler(state), body);

      assert.equal(result.status, 400, message);
      assert.equal(result.body.error, message);
    }
  }
});

// Restore shares the error allowlist, so prove it cannot be used to leak internals
// and prove reauthentication was still never required for it.
test("restore cannot leak database internals and still needs no reauthentication", async () => {
  const state = fixture();
  state.rpcError = { message: 'syntax error at or near "public.private_fn"' };
  const result = await call(loadHandler(state), {
    action: "restore_student_participation",
    student_id: 1,
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Student organization participation could not be updated.");
  assert.ok(!JSON.stringify(result.body).includes("private_fn"));
  assert.equal(state.signInAttempts.length, 0);
});

// FRONTEND: password must never be persisted and must be cleared on every exit path.
test("the removal client sends the confirmation and password and never persists them", () => {
  const source = readFileSync(BOARD_UTILS, "utf8");

  assert.match(source, /confirm_student_number: confirmStudentNumber/);
  assert.match(source, /password,/);

  // No credential handling of any kind in this client module.
  for (const forbidden of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/]) {
    assert.ok(!forbidden.test(source), `${forbidden} must not appear in the removal client`);
  }
});

test("the Board Remove dialog clears the password on open, cancel, success and failure", () => {
  const source = readFileSync("src/pages/board/Students.jsx", "utf8");

  // A single reset helper owns every clearing path.
  assert.match(source, /function resetRemoveReauthentication\(\)/);
  const reset = source.slice(source.indexOf("function resetRemoveReauthentication"));
  const helperEnd = reset.indexOf("function handleRemoveMembership");
  const helper = reset.slice(0, helperEnd);
  assert.match(helper, /setRemovePassword\(""\)/);

  // On open, on cancel/close, and after a successful removal.
  const open = source.slice(source.indexOf("function handleRemoveMembership"));
  assert.match(open.slice(0, open.indexOf("function closeRemoveDialog")), /resetRemoveReauthentication\(\)/);
  assert.match(source.slice(source.indexOf("function closeRemoveDialog"), source.indexOf("function removeFailureMessage")), /resetRemoveReauthentication\(\)/);
  const success = source.slice(source.indexOf("async function confirmRemoveMembership"));
  assert.match(success.slice(0, success.indexOf("function handleRestoreMembership")), /resetRemoveReauthentication\(\)/);

  // After a failed attempt the password is dropped even though the dialog stays open,
  // and a finally block guarantees it even if the request throws.
  assert.match(success, /setRemovePassword\(""\);/);
  const finallyBlock = success.slice(success.indexOf("} finally {"));
  assert.match(finallyBlock, /setRemovePassword\(""\)/, "password must be cleared in finally");
  assert.match(finallyBlock, /setParticipationSubmitting\(false\)/, "submit state must be released in finally");

  // Never written to web storage and never logged.
  assert.ok(!/setRemovePassword\([^)]*localStorage/.test(source));
  assert.ok(!/console\.[a-z]+\([^)]*removePassword/.test(source));
  assert.ok(!/console\.[a-z]+\([^)]*password/i.test(source));
  // No error object is logged on the credential path at all.
  assert.ok(!/console\.error\(\s*"Failed to remove/i.test(source));
});
