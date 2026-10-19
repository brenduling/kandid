import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const correction = await read("supabase/migrations/20261019090000_restrict_existing_student_term_enrollment_rpc.sql");
const boardRegistration = await read("supabase/migrations/20261021120000_board_verified_student_registration.sql");
const definitionMigration = await read("supabase/migrations/20260923120000_term_aware_manual_student_registration.sql");
const superAdminEdge = await read("supabase/functions/super-admin-manual-enrollment/index.ts");
const boardEdge = await read("supabase/functions/board-manual-enrollment/index.ts");
const superAdminClient = await read("src/utils/superAdminManualEnrollment.js");

function definition(source) {
  const start = source.indexOf("create or replace function public.enroll_existing_student_for_term_v1(");
  const end = source.indexOf("revoke all on function public.create_manual_student_for_term_v1", start);
  assert.notEqual(start, -1, "existing-student enrollment function exists");
  assert.notEqual(end, -1, "existing-student enrollment function body terminates");
  return source.slice(start, end);
}

test("RPC execution is service-role-only, including effective PUBLIC grants", () => {
  assert.match(correction, /revoke all on function public\.enroll_existing_student_for_term_v1\([\s\S]*?from public, anon, authenticated/i);
  assert.match(correction, /grant execute on function public\.enroll_existing_student_for_term_v1\([\s\S]*?to service_role/i);
  assert.match(correction, /has_function_privilege\([\s\S]*?'service_role'[\s\S]*?'EXECUTE'[\s\S]*?has_function_privilege\([\s\S]*?'anon'[\s\S]*?'EXECUTE'[\s\S]*?has_function_privilege\([\s\S]*?'authenticated'[\s\S]*?'EXECUTE'/i);
});

test("authorized Edge workflows validate the actor before service-role enrollment", () => {
  const superAdminAuth = superAdminEdge.slice(
    superAdminEdge.indexOf("async function requireSuperAdmin"),
    superAdminEdge.indexOf("async function loadActiveTerm"),
  );
  assert.match(superAdminAuth, /authClient\.auth\.getUser\(\)/);
  assert.match(superAdminAuth, /adminProfile\.role !== "super_admin"[\s\S]*?adminProfile\.status !== "active"/);
  assert.match(superAdminAuth, /createClient\(supabaseUrl, serviceRoleKey/);
  assert.match(superAdminEdge, /adminClient\.rpc\("enroll_existing_student_for_term_v1"/);

  const boardAuth = boardEdge.slice(
    boardEdge.indexOf("async function requireElectoralBoard"),
    boardEdge.indexOf("async function ", boardEdge.indexOf("async function requireElectoralBoard") + 20),
  );
  assert.match(boardAuth, /adminProfile\.role !== "electoral_board"[\s\S]*?adminProfile\.status !== "active"/);
  assert.match(boardEdge, /adminClient\.rpc\("kandid_board_register_verified_student_for_term_v1"/);
  assert.match(boardEdge, /p_actor_admin_id:\s*Number\(adminProfile\.id\)[\s\S]*?p_board_organization_id:\s*Number\(adminProfile\.organization_id\)/);
  assert.match(boardRegistration, /set search_path = pg_catalog[\s\S]*?alter function public\.kandid_board_register_verified_student_for_term_v1[\s\S]*?owner to postgres/i);
  assert.match(boardRegistration, /revoke all on function public\.kandid_board_register_verified_student_for_term_v1[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(boardRegistration, /grant execute on function public\.kandid_board_register_verified_student_for_term_v1[\s\S]*?to service_role/i);
  assert.doesNotMatch(superAdminClient, /enroll_existing_student_for_term_v1/,
    "the browser invokes the authenticated Edge Function, not the database RPC");
});

test("trusted Super Admin re-enrollment restores only an eligible current-term record", () => {
  const rpc = definition(definitionMigration);
  assert.match(rpc, /where at\.id = p_academic_term_id\s+and at\.status = 'active'/i);
  assert.match(rpc, /existing_enrollment_status <> 'not_in_masterlist'/i);
  assert.match(rpc, /set program = normalized_program,[\s\S]*?enrollment_status = 'enrolled'/i);
  assert.match(rpc, /outcome := 'EXISTING_STUDENT_TERM_RESTORED'/i);
  assert.match(superAdminEdge, /"EXISTING_STUDENT_ENROLLED", "EXISTING_STUDENT_TERM_RESTORED"/);
  assert.match(superAdminClient, /action: "enroll_existing_student_for_term"/);
});

test("the function uses only schema-qualified application objects and a pg_catalog-only search path", () => {
  const rpc = definition(definitionMigration);
  assert.match(rpc, /set search_path = pg_catalog, public, pg_temp/i);
  assert.match(correction, /set search_path = pg_catalog/i);
  assert.doesNotMatch(rpc, /\b(?:from|join|update|insert\s+into)\s+(?!public\.)[a-z_][a-z_0-9.]*/i,
    "application relation references in the SECURITY DEFINER function are schema-qualified");
  assert.match(correction, /function_owner is distinct from 'postgres'[\s\S]*?function_security_definer is distinct from true/i);
});
