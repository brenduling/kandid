import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as membershipAdmission from "../supabase/functions/_shared/membershipAdmission.js";
import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const FUNCTION_PATH = "supabase/functions/super-admin-manual-enrollment/index.ts";
const BOARD_FUNCTION_PATH = "supabase/functions/board-manual-enrollment/index.ts";
const ORGANIZATION_ACCESS_PATH = "src/utils/organizationAccess.js";
const PAGE_PATH = "src/pages/superadmin/Organizations.jsx";
function fixture(overrides = {}) {
  return {
    userId: "super-admin-auth",
    authenticated: true,
    profile: {
      id: 42,
      auth_user_id: "super-admin-auth",
      full_name: "Trusted Super Admin",
      role: "super_admin",
      status: "active",
    },
    organization: { id: 1, name: "PSITS", organization_type: "non_departmental", membership_scope: "manual" },
    rpcCalls: [],
    auditRows: [],
    rpcData: [{
      status: "removed",
      already_applied: false,
      academic_term_id: 7,
      academic_year: "2026-2027",
      semester: "1st Semester",
      organization_name: "PSITS",
      student_number: "58124",
      first_name: "Bren",
      last_name: "Alzaga",
    }],
    rpcError: null,
    auditError: null,
    ...overrides,
  };
}

function loadHandler(state) {
  let handler;
  const source = readFile(FUNCTION_PATH, "utf8");
  return source.then((text) => {
    const compiled = transformSync(text, {
      loader: "ts",
      format: "cjs",
      target: "es2022",
    }).code;
    const createClient = (_url, key) => {
      if (key === "anon") {
        return {
          auth: {
            getUser: async () => state.authenticated
              ? { data: { user: { id: state.userId } }, error: null }
              : { data: { user: null }, error: { message: "invalid session" } },
          },
        };
      }
      return {
        from(table) {
          const filters = {};
          return {
            select() { return this; },
            eq(column, value) { filters[column] = value; return this; },
            async maybeSingle() {
              if (table === "admin_users") {
                const matches = state.profile && state.profile.auth_user_id === filters.auth_user_id;
                return { data: matches ? state.profile : null, error: null };
              }
              if (table === "organizations") {
                return { data: state.organization?.id === filters.id ? state.organization : null, error: null };
              }
              throw new Error(`Unexpected query table ${table}`);
            },
            insert(row) {
              if (table !== "audit_logs") throw new Error(`Unexpected insert table ${table}`);
              state.auditRows.push(row);
              return Promise.resolve({ error: state.auditError });
            },
          };
        },
        async rpc(name, args) {
          state.rpcCalls.push({ name, args });
          return { data: state.rpcData, error: state.rpcError };
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
        env: { get: (key) => ({
          SUPABASE_URL: "url",
          SUPABASE_ANON_KEY: "anon",
          SUPABASE_SERVICE_ROLE_KEY: "service",
        })[key] },
        serve: (value) => { handler = value; },
      },
      Request,
      Response,
      console,
    }, { filename: FUNCTION_PATH });
    return handler;
  });
}

async function call(handler, body, { authorization = true } = {}) {
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: authorization ? { Authorization: "Bearer test" } : {},
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

function removalBody(overrides = {}) {
  return {
    action: "remove_current_organization_membership",
    student_id: 18,
    organization_id: 1,
    reason: "Membership is no longer current for this term.",
    ...overrides,
  };
}

test("Super Admin current-member removal reuses Board's trusted term participation RPC", async () => {
  const state = fixture();
  const result = await call(await loadHandler(state), removalBody());

  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, "removed");
  assert.equal(result.body.data.academic_term.id, 7);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].name, "board_update_student_participation");
  assert.deepEqual({ ...state.rpcCalls[0].args }, {
    target_student_id: 18,
    target_organization_id: 1,
    actor_admin_id: 42,
    target_action: "remove",
    target_reason: "Membership is no longer current for this term.",
  });
});

test("Super Admin cannot remove program-scope participation through the manual endpoint", async () => {
  const state = fixture({
    organization: { id: 1, name: "PSITS", organization_type: "departmental", membership_scope: "program" },
  });
  const result = await call(await loadHandler(state), removalBody());
  assert.equal(result.status, 403);
  assert.equal(result.body.data.outcome, "ACTIVATION_SYNC_REQUIRED");
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.auditRows.length, 0);
});

test("Super Admin identity comes from active admin_users and supplies the RPC actor", async () => {
  const state = fixture();
  await call(await loadHandler(state), removalBody());
  assert.equal(state.rpcCalls[0].args.actor_admin_id, 42);
  assert.equal(state.rpcCalls[0].args.actor_admin_id, state.profile.id);
});

test("inactive or non-Super-Admin callers cannot remove current membership", async (t) => {
  for (const profile of [
    { ...fixture().profile, status: "inactive" },
    { ...fixture().profile, role: "electoral_board" },
  ]) {
    await t.test(`${profile.role}/${profile.status}`, async () => {
      const state = fixture({ profile });
      const result = await call(await loadHandler(state), removalBody());
      assert.equal(result.status, 403);
      assert.equal(state.rpcCalls.length, 0);
      assert.equal(state.auditRows.length, 0);
    });
  }
});

test("unauthenticated requests and client-supplied actor identities fail before mutation", async () => {
  const unauthenticated = fixture({ authenticated: false });
  const unauthenticatedResult = await call(await loadHandler(unauthenticated), removalBody());
  assert.equal(unauthenticatedResult.status, 401);
  assert.equal(unauthenticated.rpcCalls.length, 0);

  const forgedActor = fixture();
  const forgedResult = await call(await loadHandler(forgedActor), removalBody({ actor_admin_id: 999 }));
  assert.equal(forgedResult.status, 400);
  assert.equal(forgedActor.rpcCalls.length, 0);
});

test("one trusted Super Admin audit event records actor, organization, and term without student identity", async () => {
  const state = fixture();
  await call(await loadHandler(state), removalBody());
  assert.equal(state.auditRows.length, 1);
  const [event] = state.auditRows;
  assert.equal(event.user_id, 42);
  assert.equal(event.actor_role, "super_admin");
  assert.equal(event.event_type, "membership_removed");
  assert.equal(event.organization_id, 1);
  assert.equal(event.organization_name, "PSITS");
  assert.deepEqual(JSON.parse(JSON.stringify(event.metadata)), { academic_term_id: 7 });
  assert.equal("student_number" in event, false);
  assert.equal(event.entity_label, "Organization participation");
});

test("already-removed membership is idempotent and does not create a duplicate audit event", async () => {
  const state = fixture({ rpcData: [{ ...fixture().rpcData[0], already_applied: true }] });
  const result = await call(await loadHandler(state), removalBody());
  assert.equal(result.status, 200);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.auditRows.length, 0);
});

test("the Super Admin member UI uses only the trusted current-term operation", async () => {
  const [page, helper, access, board] = await Promise.all([
    readFile(PAGE_PATH, "utf8"),
    readFile("src/utils/superAdminManualEnrollment.js", "utf8"),
    readFile(ORGANIZATION_ACCESS_PATH, "utf8"),
    readFile(BOARD_FUNCTION_PATH, "utf8"),
  ]);
  assert.match(helper, /action: "remove_current_organization_membership"/);
  assert.match(page, /removeSuperAdminCurrentOrganizationMembership\(/);
  assert.doesNotMatch(page, /\.from\("student_organizations"\)[\s\S]{0,180}\.delete\(/);
  assert.doesNotMatch(access, /removeStudentOrganizationMembership|\.from\("student_organizations"\)[\s\S]{0,180}\.delete\(/);
  assert.match(board, /target_organization_id: Number\(adminProfile\.organization_id\)/);
  assert.match(board, /actor_admin_id: Number\(adminProfile\.id\)/);
});

test("the shared RPC changes only current-term participation and preserves structure/enrollment/history", async () => {
  const rpc = await readFile(
    "supabase/migration_archive/20260910120500_board_student_participation_actions.sql",
    "utf8",
  );
  const removeBranch = rpc.slice(rpc.indexOf("if normalized_action = 'remove' then"), rpc.indexOf("else\n    if participation.status = 'active' then"));
  assert.match(removeBranch, /update public\.student_organization_terms[\s\S]*?set\s+status = 'removed'/i);
  assert.doesNotMatch(removeBranch, /delete\s+from\s+public\.student_organizations/i);
  assert.doesNotMatch(removeBranch, /update\s+public\.student_term_enrollments/i);
  assert.match(removeBranch, /removed_by = actor_admin_id/);
  assert.match(removeBranch, /removed_at = now\(\)/);
  assert.match(removeBranch, /insert into public\.student_notifications/i);
});

test("trusted current-member counts exclude removed term participation and unenrolled students", async () => {
  const eligibility = (await readFile("supabase/functions/organization-eligibility/index.ts", "utf8")).replace(/\r\n/g, "\n");
  const countPath = eligibility.slice(
    eligibility.indexOf("async function handleCurrentOrganizationMemberCount"),
    eligibility.indexOf("Deno.serve"),
  );
  const canonicalReader = eligibility.match(/async function loadCanonicalMembershipRows\([\s\S]*?\n}\n\nasync function requireAdmin/)?.[0];
  assert.ok(canonicalReader);
  assert.match(canonicalReader, /from\("student_organization_terms"\)[\s\S]*?\.eq\("status", "active"\)/);
  assert.match(canonicalReader, /from\("student_term_enrollments"\)[\s\S]*?\.eq\("enrollment_status", "enrolled"\)/);
  assert.match(canonicalReader, /resolve_student_organization_participation/);
  assert.match(countPath, /loadCanonicalMembershipRows\(adminClient, activeTerm, \{ organizationId \}\)/);
});
