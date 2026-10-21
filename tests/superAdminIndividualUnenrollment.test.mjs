import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as membershipAdmission from "../supabase/functions/_shared/membershipAdmission.js";
import {
  corsHeaders,
  handleCorsPreflight,
  rejectDisallowedOrigin,
  serveWithKandidCors,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const EDGE_PATH = "supabase/functions/super-admin-manual-enrollment/index.ts";
const MIGRATION_PATH = "supabase/migrations/20261019100000_super_admin_individual_current_term_unenrollment.sql";
const ENROLLMENT_MIGRATION_PATH = "supabase/migrations/20260923120000_term_aware_manual_student_registration.sql";
const MEMBERSHIP_MIGRATION_PATH = "supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql";
const CANDIDATE_MIGRATION_PATH = "supabase/migrations/20260928140000_harden_candidate_mutations.sql";
const SUBMIT_VOTE_PATH = "supabase/functions/submit-vote/index.ts";
const BALLOT_MIGRATION_PATH = "supabase/migrations/20260913155000_create_ballot_v1_submission_rpc.sql";
const PAGE_PATH = "src/pages/superadmin/Students.jsx";
const HELPER_PATH = "src/utils/superAdminManualEnrollment.js";

function fixture(overrides = {}) {
  return {
    userId: "super-admin-auth",
    authenticated: true,
    profile: { id: 42, auth_user_id: "super-admin-auth", role: "super_admin", status: "active" },
    rpcCalls: [],
    rpcData: { outcome: "UNENROLLED_CURRENT_TERM", student_id: 19, academic_term_id: 7, enrollment_status: "not_in_masterlist" },
    rpcError: null,
    ...overrides,
  };
}

async function loadHandler(state) {
  let handler;
  const deno = {
    env: { get: (key) => ({
      SUPABASE_URL: "local-url",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    })[key] },
    serve: (value) => { handler = value; },
  };
  const text = await readFile(EDGE_PATH, "utf8");
  const compiled = transformSync(text, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const createClient = (_url, key) => key === "anon"
    ? { auth: { getUser: async () => state.authenticated
      ? { data: { user: { id: state.userId } }, error: null }
      : { data: { user: null }, error: { message: "invalid session" } } } }
    : {
      from(table) {
        const filters = {};
        return {
          select() { return this; },
          eq(column, value) { filters[column] = value; return this; },
          async maybeSingle() {
            if (table !== "admin_users") throw new Error(`Unexpected query table ${table}`);
            return {
              data: state.profile?.auth_user_id === filters.auth_user_id ? state.profile : null,
              error: null,
            };
          },
        };
      },
      async rpc(name, args) {
        state.rpcCalls.push({ name, args });
        return { data: state.rpcData, error: state.rpcError };
      },
    };
  vm.runInNewContext(compiled, {
    require: (specifier) => specifier.includes("membershipAdmission")
      ? membershipAdmission
      : specifier.includes("kandidProductionSecurity")
      ? {
        corsHeaders,
        handleCorsPreflight,
        rejectDisallowedOrigin,
        serveWithKandidCors: (handlerFn) => deno.serve(async (request) =>
          withKandidCors(request, await handlerFn(request))),
      }
      : ({ createClient }),
    module: { exports: {} },
    exports: {},
    Deno: deno,
    Request,
    Response,
    console: { error() {} },
  }, { filename: EDGE_PATH });
  return handler;
}

async function call(handler, body, { authorization = true } = {}) {
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: authorization ? { Authorization: "Bearer test" } : {},
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const request = { action: "unenroll_student_for_current_term", student_id: 19 };

test("active Super Admin unenrollment invokes the scoped trusted RPC with the server-resolved actor", async () => {
  const state = fixture();
  const result = await call(await loadHandler(state), request);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.outcome, "UNENROLLED_CURRENT_TERM");
  assert.deepEqual(JSON.parse(JSON.stringify(state.rpcCalls)), [{
    name: "kandid_super_admin_unenroll_student_for_current_term",
    args: { p_actor_admin_id: 42, p_student_id: 19 },
  }]);
});

test("unauthenticated, inactive, or non-Super-Admin callers cannot invoke unenrollment", async (t) => {
  for (const state of [
    fixture({ authenticated: false }),
    fixture({ profile: { ...fixture().profile, status: "inactive" } }),
    fixture({ profile: { ...fixture().profile, role: "electoral_board" } }),
  ]) {
    await t.test(`${state.authenticated ? state.profile.role + "/" + state.profile.status : "anonymous"}`, async () => {
      const result = await call(await loadHandler(state), request, { authorization: state.authenticated });
      assert.equal(result.status, state.authenticated ? 403 : 401);
      assert.equal(state.rpcCalls.length, 0);
    });
  }
});

test("client cannot choose the acting administrator or add unsupported unenrollment fields", async () => {
  const state = fixture();
  const result = await call(await loadHandler(state), { ...request, p_actor_admin_id: 999 });
  assert.equal(result.status, 400);
  assert.equal(state.rpcCalls.length, 0);
});

test("database authorization and effective execute grants are independently enforced", async () => {
  const migration = await readFile(MIGRATION_PATH, "utf8");
  assert.match(migration, /where a\.id = p_actor_admin_id[\s\S]*?a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(migration, /revoke all on function public\.kandid_super_admin_unenroll_student_for_current_term\(bigint, integer\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_super_admin_unenroll_student_for_current_term\(bigint, integer\)\s+to service_role/i);
  assert.match(migration, /has_function_privilege\('service_role', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /has_function_privilege\('anon', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /has_function_privilege\('authenticated', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /pg_catalog\.aclexplode[\s\S]*?acl\.grantee = 0[\s\S]*?EXECUTE/i);
  assert.match(migration, /enroll_existing_student_for_term_v1\(integer,integer,text,integer,boolean\)[\s\S]*?service_role/i);
});

test("unenrollment is term-scoped, idempotent, auditable, and does not edit identity or history", async () => {
  const migration = await readFile(MIGRATION_PATH, "utf8");
  assert.match(migration, /select pg_catalog\.count\(\*\)::integer, pg_catalog\.min\(t\.id\)[\s\S]*?where t\.status = 'active'[\s\S]*?active_term_count <> 1/i);
  assert.match(migration, /where ste\.student_id = p_student_id\s+and ste\.academic_term_id = active_term_id\s+for update/i);
  assert.match(migration, /if enrollment_status_value = 'not_in_masterlist' then[\s\S]*?'ALREADY_UNENROLLED_CURRENT_TERM'[\s\S]*?return/i);
  assert.match(migration, /update public\.student_term_enrollments ste\s+set enrollment_status = 'not_in_masterlist',[\s\S]*?where ste\.id = enrollment_id/i);
  assert.match(migration, /insert into public\.audit_logs/i);
  assert.doesNotMatch(migration, /update public\.students|delete\s+from public\.(students|student_organization_terms|student_organizations|votes|vote_ballots)|auth\.users/i);
  assert.doesNotMatch(migration, /update public\.student_organization_terms/i);
});

test("existing re-enrollment RPC accepts the established unenrolled status and avoids duplicate enrollment rows", async () => {
  const migration = await readFile(ENROLLMENT_MIGRATION_PATH, "utf8");
  assert.match(migration, /if enrollment_found and existing_enrollment_status = 'enrolled' then/i);
  assert.match(migration, /if enrollment_found and existing_enrollment_status <> 'not_in_masterlist' then/i);
  assert.match(migration, /update public\.student_term_enrollments[\s\S]*?enrollment_status = 'enrolled'[\s\S]*?where id = existing_enrollment_id/i);
  assert.match(migration, /student_term_enrollments_unique_student_term/i);
});

test("term re-enrollment cannot silently change program and bypass automatic membership reconciliation", async () => {
  const [edge, page] = await Promise.all([
    readFile(EDGE_PATH, "utf8"),
    readFile(PAGE_PATH, "utf8"),
  ]);
  assert.match(edge, /currentEnrollment\?\.enrollment_status === "not_in_masterlist"[\s\S]*?normalizeProgram\(currentEnrollment\.program\) !== program[\s\S]*?PROGRAM_CHANGE_REQUIRES_MASTERLIST_REVIEW/);
  assert.match(page, /PROGRAM_CHANGE_REQUIRES_MASTERLIST_REVIEW:[\s\S]*?trusted Masterlist Review workflow/);
});

test("unenrolled status denies organization and candidate participation while automatic voting still requires enrollment", async () => {
  const [membership, candidate, submitVote] = await Promise.all([
    readFile(MEMBERSHIP_MIGRATION_PATH, "utf8"),
    readFile(CANDIDATE_MIGRATION_PATH, "utf8"),
    readFile(SUBMIT_VOTE_PATH, "utf8"),
  ]);
  const resolver = membership.slice(membership.indexOf("create or replace function public.resolve_student_organization_participation"));
  assert.match(resolver, /enrollment_status_value <> 'enrolled'[\s\S]*?not_enrolled_for_term/i);
  assert.match(candidate, /resolve_student_organization_participation\([\s\S]*?participation_allowed is distinct from true/i);
  assert.match(submitVote,/authClient\.rpc\(\s*"kandid_check_student_ballot_eligibility"/);
  const current=await readFile('supabase/proposals/automatic-voter-eligibility.core.sql','utf8');
  assert.match(current,/ste\.enrollment_status='enrolled'/);
});

test("re-enrollment continues to use trusted membership admission and duplicate-vote safeguards", async () => {
  const [edge, membership, ballot] = await Promise.all([
    readFile(EDGE_PATH, "utf8"),
    readFile(MEMBERSHIP_MIGRATION_PATH, "utf8"),
    readFile(BALLOT_MIGRATION_PATH, "utf8"),
  ]);
  assert.match(edge, /enroll_existing_student_for_term_v1/);
  assert.match(edge, /ensureSuperAdminMemberships\(/);
  assert.match(membership, /if participation_row\.status = 'removed' and organization_scope <> 'manual' then[\s\S]*?ACTIVATION_SYNC_REQUIRED/i);
  assert.match(ballot, /already voted in this election/i);
});

test("Students interface requires explicit confirmation and explains the participation impact", async () => {
  const [page, helper] = await Promise.all([
    readFile(PAGE_PATH, "utf8"),
    readFile(HELPER_PATH, "utf8"),
  ]);
  assert.match(helper, /action: "unenroll_student_for_current_term"/);
  assert.match(page, /Unenroll Student for the Current Term\?/);
  assert.match(page, /candidate-registration eligibility, and voting eligibility/);
  assert.match(page, /Their account, directory access, history, submitted ballots, and receipts will remain unchanged/);
  assert.match(page, /resolveSuperAdminStudentForTerm\([\s\S]*?unenrollSuperAdminStudentForCurrentTerm/);
});
