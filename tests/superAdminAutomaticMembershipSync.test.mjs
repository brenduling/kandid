import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const EDGE_PATH = "supabase/functions/super-admin-manual-enrollment/index.ts";
const MIGRATION_PATH = "supabase/migrations/20261020100000_super_admin_current_term_membership_sync.sql";

test("Super Admin create and re-enrollment invoke trusted automatic membership sync and fail closed", async () => {
  const edge = await read(EDGE_PATH);
  const helperStart = edge.indexOf("async function ensureSuperAdminMemberships(");
  const helperEnd = edge.indexOf("async function ", helperStart + 20);
  const helper = edge.slice(helperStart, helperEnd);

  assert.match(helper, /kandid_super_admin_sync_current_term_memberships/);
  assert.match(helper, /p_actor_admin_id:\s*actorAdminId/);
  assert.match(helper, /p_student_id:\s*studentId/);
  assert.match(helper, /if \(syncError\)[\s\S]*?error:\s*syncError/);
  assert.match(helper, /kandid_super_admin_sync_current_term_memberships[\s\S]*?resolveMembershipOrganizationIds/);
  assert.equal((edge.match(/ensureSuperAdminMemberships\(/g) || []).length, 3,
    "both trusted Super Admin enrollment handlers use the shared synchronization helper");
});

test("trusted RPC enforces active Super Admin, one active term, and current enrollment", async () => {
  const migration = await read(MIGRATION_PATH);
  const rpcStart = migration.indexOf("create or replace function public.kandid_super_admin_sync_current_term_memberships(");
  const rpcEnd = migration.indexOf("alter function public.kandid_super_admin_sync_current_term_memberships", rpcStart);
  const rpc = migration.slice(rpcStart, rpcEnd);

  assert.notEqual(rpcStart, -1);
  assert.match(rpc, /security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(rpc, /a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(rpc, /from public\.academic_terms t\s+where t\.status = 'active'\s+for share[\s\S]*?count\(\*\)::integer/i);
  assert.match(rpc, /count\(\*\)::integer[\s\S]*?where t\.status = 'active'[\s\S]*?active_term_count <> 1/i);
  assert.match(rpc, /ste\.enrollment_status = 'enrolled'[\s\S]*?for update/i);
  assert.match(rpc, /pg_advisory_xact_lock\(p_student_id, active_term_id\)/i);
});

test("sync creates only automatic scopes with guarded system provenance and remains repeat-safe", async () => {
  const [migration, masterlistMigration, schema] = await Promise.all([
    read(MIGRATION_PATH),
    read("supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql"),
    read("tests/fixtures/superAdminStudentsProductionContract.json"),
  ]);
  const rpcStart = migration.indexOf("create or replace function public.kandid_super_admin_sync_current_term_memberships(");
  const rpcEnd = migration.indexOf("alter function public.kandid_super_admin_sync_current_term_memberships", rpcStart);
  const rpc = migration.slice(rpcStart, rpcEnd);

  assert.match(rpc, /o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.match(rpc, /set_config\('kandid\.membership_activation_term_id', active_term_id::text, true\)/i);
  assert.match(rpc, /insert into public\.student_organization_terms\s*\([\s\S]*?values \([\s\S]*?'active', 'system'/i);
  assert.match(rpc, /on conflict \(student_id, organization_id\) do nothing/i);
  assert.match(rpc, /for update/i);
  assert.ok(
    rpc.indexOf("insert into public.student_organization_terms") < rpc.indexOf("insert into public.student_organizations"),
    "term admission is validated before creating the structural projection",
  );
  const finalizerStart = masterlistMigration.indexOf("create or replace function public.kandid_finalize_masterlist_import_with_membership_sync(");
  const finalizerEnd = masterlistMigration.indexOf("alter function public.kandid_finalize_masterlist_import_with_membership_sync", finalizerStart);
  const finalizer = masterlistMigration.slice(finalizerStart, finalizerEnd);
  assert.ok(
    finalizer.indexOf("insert into public.student_organization_terms") < finalizer.indexOf("insert into public.student_organizations"),
    "ordering matches the working trusted Masterlist finalizer",
  );
  assert.deepEqual(JSON.parse(schema).membershipConstraints, [{
    conname: "student_organization_terms_unique",
    definition: "UNIQUE (student_id, organization_id, academic_term_id)",
  }]);
  assert.doesNotMatch(migration, /public\.(elections|votes|vote_ballots|election_eligible_voters|frozen_electorates)/i);
});

test("eligible program memberships restore only program-change removals; manual removals are untouched", async () => {
  const migration = await read(MIGRATION_PATH);
  const rpcStart = migration.indexOf("create or replace function public.kandid_super_admin_sync_current_term_memberships(");
  const rpcEnd = migration.indexOf("alter function public.kandid_super_admin_sync_current_term_memberships", rpcStart);
  const rpc = migration.slice(rpcStart, rpcEnd);

  assert.match(rpc, /membership_row\.status = 'removed'[\s\S]*?organization_row\.membership_scope = 'program'[\s\S]*?membership_row\.removal_reason = 'program_change_reconciliation'/i);
  assert.match(rpc, /membership_row\.source = 'system'[\s\S]*?membership_row\.removal_reason = 'program_change_reconciliation'/i);
  assert.match(rpc, /sot\.source = 'system'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.match(rpc, /where sot\.id = membership_row\.id/i);
  assert.match(rpc, /where o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.doesNotMatch(rpc, /membership_scope = 'manual'[\s\S]*?set status = 'active'/i);
  assert.match(rpc, /elsif membership_row\.status = 'removed'[\s\S]*?continue/i);
});

test("database RPC is service-role-only and validates the SECURITY DEFINER contract", async () => {
  const migration = await read(MIGRATION_PATH);
  assert.match(migration, /alter function public\.kandid_super_admin_sync_current_term_memberships\(bigint, integer\) owner to postgres/i);
  assert.match(migration, /revoke all on function public\.kandid_super_admin_sync_current_term_memberships\(bigint, integer\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_super_admin_sync_current_term_memberships\(bigint, integer\)\s+to service_role/i);
  assert.match(migration, /has_function_privilege\('service_role', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /has_function_privilege\('anon', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /has_function_privilege\('authenticated', target_oid, 'EXECUTE'\)/i);
  assert.match(migration, /acl\.grantee = 0[\s\S]*?EXECUTE/i);
  assert.match(migration, /configured_search_path is distinct from array\['search_path=pg_catalog'\]/i);
});
