import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  corsHeadersForOrigin,
  handleCorsPreflight,
} from "../supabase/proposals/super-admin-dashboard-recovery/edge/functions/_shared/kandidProductionSecurity.mjs";

const proposalRoot = new URL("../supabase/proposals/", import.meta.url);
const recoveryRoot = new URL("super-admin-dashboard-recovery/", proposalRoot);
const readText = (relativePath) => readFile(new URL(relativePath, proposalRoot), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function boardCandidateAccess({
  userId,
  role,
  status,
  organizationId,
  candidateOrganizationId,
  isCandidate,
}) {
  return Boolean(
    userId && role === "electoral_board" && status === "active" && isCandidate &&
    organizationId != null && organizationId === candidateOrganizationId,
  );
}

function studentPolicyAccess({
  userId,
  role,
  adminStatus,
  studentUserId,
  studentStatus,
  boardCandidate = null,
}) {
  if (userId && role === "super_admin" && adminStatus === "active") return true;
  if (userId && studentUserId === userId && studentStatus === "active") return true;
  return boardCandidate ? boardCandidateAccess({ userId, ...boardCandidate }) : false;
}

test("narrow students policy keeps Super Admin and active self access, scopes Board access by election organization", async () => {
  const sql = await readText("super-admin-dashboard-students-policy-fix.sql");
  assert.match(sql, /security definer\s+set search_path = pg_catalog/i);
  assert.match(sql, /alter function private\.kandid_board_can_read_candidate_student\(integer\) owner to postgres/i);
  assert.match(sql, /revoke all on function private\.kandid_board_can_read_candidate_student\(integer\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant usage on schema private to authenticated/i);
  assert.match(sql, /grant execute on function private\.kandid_board_can_read_candidate_student\(integer\)\s+to authenticated/i);
  assert.doesNotMatch(sql, /\bgrant\s+(?:select|all(?:\s+privileges)?)\b[^;]*\bpublic\.candidates\b/i);
  assert.doesNotMatch(sql, /grant execute on function private\.kandid_active_admin_can_access_organization/i);
  assert.match(sql, /a\.role = 'electoral_board'[\s\S]*a\.status = 'active'[\s\S]*a\.organization_id = e\.organization_id/i);
  assert.match(sql, /private\.kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
  assert.match(sql, /auth\.uid\(\) is not null and exists \([\s\S]*a\.role = 'super_admin'/i);
  assert.match(sql, /auth\.uid\(\) is not null and students\.auth_user_id = auth\.uid\(\) and students\.status = 'active'/i);
  assert.match(sql, /or private\.kandid_board_can_read_candidate_student\(students\.id\)/i);
  assert.match(sql, /relforcerowsecurity is distinct from false/i);
  assert.ok(sql.includes("regexp_count(students_policy_normalized, 'auth_user_id\\s*=\\s*auth\\.uid\\(\\)') < 2"));

  const capturedProductionPolicy = `(((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1 FROM admin_users a WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND ((a.role)::text = 'super_admin'::text))))) OR ((auth.uid() IS NOT NULL) AND (auth_user_id = auth.uid()) AND ((status)::text = 'active'::text)) OR ((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1 FROM candidates c WHERE (c.student_id = students.id)))))`;
  const normalizedProductionPolicy = capturedProductionPolicy.toLowerCase().replace(/\s+/g, " ");
  const authUidPredicates = normalizedProductionPolicy.match(/auth_user_id\s*=\s*auth\.uid\(\)/g) || [];
  const candidateGuard = sql.match(/students_policy_normalized\s+!~\s+'([^']+)'/)?.[1];
  assert.ok(candidateGuard, "the forward preflight requires the candidate relation");
  for (const policy of [normalizedProductionPolicy, normalizedProductionPolicy.replace("from candidates c", "from public.candidates c")]) {
    assert.ok(new RegExp(candidateGuard).test(policy), "both deparsed relation renderings pass the baseline guard");
  }
  assert.ok(normalizedProductionPolicy.includes("a.role)::text = 'super_admin'"));
  assert.ok(normalizedProductionPolicy.includes("a.status)::text = 'active'"));
  assert.ok(normalizedProductionPolicy.includes("status)::text = 'active'"));
  assert.equal(authUidPredicates.length, 2, "the exact captured production expression satisfies the SQL preflight's cast-aware baseline checks");

  const base = { userId: "auth-user", isCandidate: true, organizationId: 2, candidateOrganizationId: 2 };
  assert.equal(boardCandidateAccess({ ...base, role: "electoral_board", status: "active" }), true, "same-organization active Board candidate can read");
  assert.equal(boardCandidateAccess({ ...base, role: "electoral_board", status: "active", candidateOrganizationId: 7 }), false, "cross-organization Board access is denied");
  assert.equal(boardCandidateAccess({ ...base, role: "electoral_board", status: "disabled" }), false, "disabled Board access is denied");
  assert.equal(boardCandidateAccess({ ...base, role: "electoral_board", status: "active", isCandidate: false }), false, "non-candidate access is denied");
  assert.equal(boardCandidateAccess({ ...base, userId: null, role: "electoral_board", status: "active" }), false, "anonymous access is denied");

  assert.equal(studentPolicyAccess({ userId: "sa", role: "super_admin", adminStatus: "active" }), true, "active Super Admin retains platform access");
  assert.equal(studentPolicyAccess({ userId: "sa", role: "super_admin", adminStatus: "disabled" }), false, "disabled Super Admin is denied");
  assert.equal(studentPolicyAccess({ userId: "student-a", studentUserId: "student-a", studentStatus: "active" }), true, "active student retains self access");
  assert.equal(studentPolicyAccess({ userId: "student-a", studentUserId: "student-a", studentStatus: "disabled" }), false, "inactive student self access is denied");
  assert.equal(studentPolicyAccess({ userId: "student-a", studentUserId: "student-b", studentStatus: "active" }), false, "student cannot read another student's row");
});

test("forward and rollback candidate guards handle schema qualification without accepting other relations", async () => {
  const [forward, rollback] = await Promise.all([
    readText("super-admin-dashboard-students-policy-fix.sql"),
    readText("super-admin-dashboard-students-policy-fix.rollback.sql"),
  ]);
  const guards = (sql) => [...sql.matchAll(/students_policy_normalized\s+(!?~)\s+'([^']+)'/g)];
  const forwardGuards = guards(forward);
  const rollbackGuards = guards(rollback);
  assert.deepEqual(forwardGuards.map((match) => match[1]), ["!~"]);
  assert.deepEqual(rollbackGuards.map((match) => match[1]), ["~", "!~"], "rollback rejects an old direct candidate branch before restoring it, then requires it after restoration");
  const pattern = forwardGuards[0][2];
  assert.ok(rollbackGuards.every((match) => match[2] === pattern));
  for (const sql of [forward, rollback]) assert.match(sql, /set local search_path = pg_catalog;/);

  const cases = [
    ["EXISTS (SELECT 1 FROM candidates c WHERE c.student_id = students.id)", true],
    ["EXISTS (SELECT 1 FROM public.candidates c WHERE c.student_id = students.id)", true],
    ["EXISTS (SELECT 1\r\n FROM\tpublic.candidates\tc\r\n WHERE c.student_id = students.id)", true],
    ["EXISTS (SELECT 1 FROM other.candidates c WHERE c.student_id = students.id)", false],
    ["EXISTS (SELECT 1 FROM public.candidates_archive c)", false],
    ["EXISTS (SELECT 1 FROM public.candidates candidate)", false],
    ["EXISTS (SELECT 1 FROM public.candidates cross_alias)", false],
    ["private.kandid_board_can_read_candidate_student(students.id)", false],
  ];
  for (const [policy, expected] of cases) {
    const normalized = policy.toLowerCase().replace(/\s+/g, " ");
    const hasDirectCandidateBranch = new RegExp(pattern).test(normalized);
    assert.equal(hasDirectCandidateBranch, expected, policy);
    assert.equal(!hasDirectCandidateBranch, !expected, "required-branch guard rejects a missing or unexpected relation");
  }
});

test("dashboard student reads use only the granted ID, program, and status columns", async () => {
  const dashboard = await readFile(new URL("../src/pages/superadmin/Dashboard.jsx", import.meta.url), "utf8");
  const util = await readFile(new URL("../src/utils/superAdminDashboard.js", import.meta.url), "utf8");
  const sql = await readText("super-admin-dashboard-students-policy-fix.sql");
  assert.match(dashboard, /from\("students"\)\.select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(dashboard, /\.from\("students"\)[\s\S]*?\.select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("status", "pending"\)/);
  assert.match(util, /\.from\("students"\)[\s\S]*?\.select\("program"\)[\s\S]*?\.order\("id"/);
  for (const column of ["id", "program", "status"]) {
    assert.match(sql, new RegExp(`has_column_privilege\\('authenticated', 'public\\.students', '${column}', 'SELECT'\\)`));
  }
  assert.match(dashboard, /coreResults\.some\(\(result\) => result\.error\)/);
  assert.doesNotMatch(dashboard, /mockDashboard|fallbackDashboardData/i);
  assert.doesNotMatch(dashboard, /listAdminUsers|admin-user-management/, "the core dashboard data loader has no dependency on the proposed CORS deployment");
});

test("dashboard CORS preflight allows only the approved localhost origin and POST contract", () => {
  const allowed = new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/admin-user-management", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5174",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, apikey, content-type, x-client-info",
    },
  });
  const allowedResponse = handleCorsPreflight(allowed);
  assert.equal(allowedResponse.status, 204);
  assert.equal(allowedResponse.headers.get("access-control-allow-origin"), "http://localhost:5174");
  assert.equal(allowedResponse.headers.get("access-control-allow-methods"), "POST, OPTIONS");

  for (const request of [
    new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/admin-user-management", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
    }),
    new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/admin-user-management", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5174", "access-control-request-method": "GET" },
    }),
    new Request("https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/admin-user-management", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5174", "access-control-request-method": "POST", "access-control-request-headers": "x-unapproved" },
    }),
  ]) {
    assert.equal(handleCorsPreflight(request).status, 403);
  }
});

test("CORS artifact is exactly the deployed baseline plus localhost:5174", async () => {
  const [baseline, proposed] = await Promise.all([
    readFile(new URL("baseline/kandidProductionSecurity.mjs", recoveryRoot), "utf8"),
    readFile(new URL("edge/functions/_shared/kandidProductionSecurity.mjs", recoveryRoot), "utf8"),
  ]);
  assert.equal(proposed.replace('  "http://localhost:5174",\n', ""), baseline);
  assert.equal(corsHeadersForOrigin("http://localhost:5174")["Access-Control-Allow-Origin"], "http://localhost:5174");
  assert.equal(corsHeadersForOrigin("https://attacker.example"), null);
});

test("admin-user-management keeps JWT verification and server-side Super Admin authorization", async () => {
  const config = await readFile(new URL("edge/config.toml", recoveryRoot), "utf8");
  const source = await readFile(new URL("edge/functions/admin-user-management/index.ts", recoveryRoot), "utf8");
  assert.match(config, /project_id\s*=\s*"fszgdxqxonqqcrzsnkca"/);
  assert.match(config, /\[functions\.admin-user-management\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(source, /const preflightResponse = handleCorsPreflight\(request\);/);
  assert.match(source, /const auth = await requireActiveAdmin\(request, supabaseUrl, anonKey, serviceRoleKey\);/);
  assert.match(source, /adminProfile\.role !== "super_admin"\s*&&\s*!\(adminProfile\.role === "electoral_board" && action === "update_self_profile"\)/);
  assert.match(source, /adminProfile\.status !== "active"/);
});

test("proposal SQL, rollback, and deployed CORS snapshots are hashable reviewed artifacts", async () => {
  const manifest = JSON.parse(await readFile(new URL("../docs/super-admin-dashboard-recovery-manifest.json", import.meta.url), "utf8"));
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(new URL(`../${artifact.path}`, import.meta.url));
    assert.equal(sha256(bytes), artifact.sha256, artifact.path);
  }
  const rollback = await readText("super-admin-dashboard-students-policy-fix.rollback.sql");
  assert.match(rollback, /drop function private\.kandid_board_can_read_candidate_student\(integer\)/i);
  assert.match(rollback, /from public\.candidates c/i);
});
