import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261002110000_secure_organization_program_coverage.sql",
    import.meta.url,
  ),
  "utf8",
);
const contractMigration = await readFile(
  new URL(
    "../supabase/migrations/20261002120000_contract_program_catalog_service_role_access.sql",
    import.meta.url,
  ),
  "utf8",
);
const coverageFoundation = await readFile(
  new URL(
    "../supabase/migrations/20260828_organization_program_sync.sql",
    import.meta.url,
  ),
  "utf8",
);
const profile = await readFile(
  new URL("../src/pages/shared/Profile.jsx", import.meta.url),
  "utf8",
);
const organizations = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const organizationAccess = await readFile(
  new URL("../src/utils/organizationAccess.js", import.meta.url),
  "utf8",
);
const boardEnrollment = await readFile(
  new URL("../supabase/functions/board-manual-enrollment/index.ts", import.meta.url),
  "utf8",
);
const superAdminEnrollment = await readFile(
  new URL("../supabase/functions/super-admin-manual-enrollment/index.ts", import.meta.url),
  "utf8",
);
const masterlistImport = await readFile(
  new URL("../supabase/functions/super-admin-masterlist-import/index.ts", import.meta.url),
  "utf8",
);
const boardRegistrationMigration = await readFile(
  new URL("../supabase/migrations/20261021120000_board_verified_student_registration.sql", import.meta.url),
  "utf8",
);

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} is defined`);
  const end = migration.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} has a closed function body`);
  return migration.slice(start, end);
}

test("browser roles have read-only program catalog and coverage access", () => {
  assert.match(migration, /revoke all on table public\.programs from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.organization_programs from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.programs to anon, authenticated/i);
  assert.match(migration, /grant select on table public\.organization_programs to anon, authenticated/i);
  assert.match(migration, /for select\s+to anon, authenticated\s+using \(true\)/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*?for all\s+to anon, authenticated/i);
  assert.match(migration, /revoke all on sequence public\.programs_id_seq from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on table public\.programs from service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.programs to service_role/i);
  assert.match(migration, /grant usage, select on sequence public\.programs_id_seq to service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.programs to service_role/i);
  assert.match(migration, /revoke all on table public\.organization_programs from public, anon, authenticated/i);
});

test("both trusted operations derive an active Super Admin from auth.uid()", () => {
  for (const name of [
    "kandid_ensure_program_catalog_entry",
    "kandid_replace_organization_program_coverage",
  ]) {
    const body = functionBody(name);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = pg_catalog/i);
    assert.match(body, /caller_uid uuid := auth\.uid\(\)/i);
    assert.match(body, /a\.auth_user_id = caller_uid/i);
    assert.match(body, /a\.role = 'super_admin'/i);
    assert.match(body, /a\.status = 'active'/i);
    assert.match(body, /errcode = '42501'/i);
  }

  assert.match(
    migration,
    /revoke all on function public\.kandid_replace_organization_program_coverage\(bigint, bigint\[\]\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.kandid_replace_organization_program_coverage\(bigint, bigint\[\]\)\s+to authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.kandid_ensure_program_catalog_entry\(text\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.kandid_ensure_program_catalog_entry\(text\)\s+to authenticated/i,
  );
  assert.match(migration, /grant select, insert, update on table public\.programs to service_role/i);
  assert.match(migration, /grant select on table public\.organization_programs to service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.programs to service_role/i);
  assert.match(migration, /grant usage, select on sequence public\.programs_id_seq to service_role/i);
});

test("contract migration removes only temporary service-role catalog writes", () => {
  assert.match(contractMigration, /^begin;[\s\S]*commit;\s*$/i);
  assert.match(contractMigration, /revoke all on table public\.programs from service_role/i);
  assert.match(contractMigration, /grant select on table public\.programs to service_role/i);
  assert.match(contractMigration, /revoke all on sequence public\.programs_id_seq from service_role/i);
  assert.doesNotMatch(contractMigration, /organization_programs|create policy|drop policy/i);
  assert.doesNotMatch(contractMigration, /revoke all on function|revoke execute/i);
  assert.match(migration, /grant execute on function public\.kandid_ensure_program_catalog_entry_for_server_actor\(text, bigint\)\s+to service_role/i);
});

test("program catalog create-or-resolve is audited atomically for server actors", () => {
  const helper = functionBody("kandid_ensure_program_catalog_entry_for_server_actor");
  assert.match(helper, /security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(helper, /a\.id = p_actor_admin_id[\s\S]*?a\.status = 'active'/i);
  assert.match(helper, /a\.role in \('electoral_board', 'super_admin'\)/i);
  assert.match(helper, /normalized_code text := pg_catalog\.upper\(pg_catalog\.btrim\(coalesce\(p_code, ''\)\)\)/i);
  assert.match(helper, /if not found then[\s\S]*?insert into public\.programs/i);
  assert.match(helper, /if inserted_rows = 0 then[\s\S]*?select p\.[\s\S]*?else[\s\S]*?insert into public\.audit_logs/i);
  assert.match(helper, /'program_catalog_entry_created'/i);
  assert.match(helper, /p_actor_admin_id,[\s\S]*?actor_name,[\s\S]*?actor_role/i);
  assert.match(helper, /'program_id', program_row\.id[\s\S]*?'code', program_row\.code[\s\S]*?'name', program_row\.name/i);
  assert.doesNotMatch(helper, /update public\.programs/i);
  assert.match(
    migration,
    /comment on function public\.kandid_ensure_program_catalog_entry_for_server_actor\(text, bigint\)/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.kandid_ensure_program_catalog_entry_for_server_actor\(text, bigint\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.kandid_ensure_program_catalog_entry_for_server_actor\(text, bigint\)\s+to service_role/i,
  );

  const superAdminRpc = functionBody("kandid_ensure_program_catalog_entry");
  assert.match(superAdminRpc, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(superAdminRpc, /a\.role = 'super_admin'/i);
  assert.match(superAdminRpc, /from public\.kandid_ensure_program_catalog_entry_for_server_actor\(\s*p_code,\s*admin_id/i);
});

test("original coverage RPC validates replacement and audit; its later replacement retires the sync side effect", () => {
  const body = functionBody("kandid_replace_organization_program_coverage");
  assert.match(body, /where o\.id = p_organization_id\s+for update/i);
  assert.match(body, /organization was not found/i);
  assert.match(body, /duplicate programs are not allowed/i);
  assert.match(body, /one or more programs were not found/i);
  assert.ok(
    body.indexOf("a.role = 'super_admin'") < body.indexOf("where o.id = p_organization_id"),
    "authorization is checked before organization lookup",
  );
  assert.match(body, /delete from public\.organization_programs/i);
  assert.match(body, /insert into public\.organization_programs/i);
  assert.match(body, /insert into public\.student_organizations/i);
  assert.match(body, /on conflict \(student_id, organization_id\) do nothing/i);
  assert.match(body, /before_programs/i);
  assert.match(body, /after_programs/i);
  assert.match(body, /synchronized_membership_insert_count/i);
  assert.match(body, /insert into public\.audit_logs/i);
  assert.match(body, /admin_id/i);
  assert.match(body, /'before_programs', before_programs/i);
  assert.match(body, /'after_programs', after_programs/i);
  assert.doesNotMatch(body, /delete from public\.student_organizations/i);
  assert.doesNotMatch(body, /public\.student_organization_terms/i);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/i);
  assert.match(coverageFoundation, /primary key \(organization_id, program_id\)/i);
});

test("Board Profile displays configured membership scope without mutation or synchronization controls", () => {
  assert.match(profile, /Organization membership scope is managed by the system administrator\./);
  assert.match(profile, /boardOrganization\.membership_scope === "institution"[\s\S]*?program coverage is not applicable/i);
  assert.match(profile, /boardOrganization\.membership_scope === "program"[\s\S]*?boardOrganization\.organization_programs/i);
  assert.match(profile, /boardOrganization\.organization_programs/);
  for (const forbidden of [
    "handleAddProgram",
    "handleSaveCoverage",
    "syncStudentsForOrganizationCoverage",
    "ensureProgram",
    'from("organization_programs")',
  ]) {
    assert.equal(profile.includes(forbidden), false, `${forbidden} is absent from Board Profile`);
  }
});

test("Super Admin organization editor uses trusted coverage operations", () => {
  assert.match(organizations, /saveOrganizationConfiguration,/);
  assert.match(organizations, /await saveOrganizationConfiguration\(/);
  assert.doesNotMatch(organizations, /replaceOrganizationProgramCoverage/);
  assert.doesNotMatch(
    organizations,
    /from\("organization_programs"\)[\s\S]{0,200}?\.(?:delete|insert|upsert)\(/,
  );
  assert.doesNotMatch(organizations, /syncStudentsForOrganizationCoverage/);
});

test("catalog creation is trusted and coverage helper passes the complete selected set", () => {
  assert.match(
    organizationAccess,
    /supabase\.rpc\(\s*"kandid_ensure_program_catalog_entry"/,
  );
  assert.doesNotMatch(organizationAccess, /from\("programs"\)\s*\.upsert/);
  assert.match(
    organizationAccess,
    /supabase\.rpc\(\s*"kandid_replace_organization_program_coverage"/,
  );
  assert.match(organizationAccess, /p_organization_id: Number\(organizationId\)/);
  assert.match(organizationAccess, /p_program_ids: normalizedIds/);
  assert.equal(organizationAccess.includes("export async function syncStudentsForOrganizationCoverage"), false);
});

test("trusted enrollment and import paths use audited server catalog resolution with their verified actor", () => {
  assert.match(
    superAdminEnrollment,
    /rpc\(\s*"kandid_ensure_program_catalog_entry_for_server_actor"[\s\S]{0,180}p_actor_admin_id: actorAdminId/i,
    "Super Admin paths use the audited catalog resolution RPC with the verified actor",
  );
  assert.doesNotMatch(
    superAdminEnrollment,
    /from\("programs"\)[\s\S]{0,180}\.(?:insert|upsert|update|delete)\(/,
  );
  assert.match(boardEnrollment, /adminClient\.rpc\("kandid_board_register_verified_student_for_term_v1"/);
  assert.match(boardRegistrationMigration, /select p\.id into v_program_id[\s\S]*?from public\.programs p/i);
  assert.match(boardRegistrationMigration, /if org_scope = 'program' and not exists \([\s\S]*?public\.organization_programs op/i);
  assert.match(boardRegistrationMigration, /for target_org in[\s\S]*?o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'[\s\S]*?organization_programs op/i);

  for (const [sourceName, source] of [
    ["Super Admin manual enrollment", superAdminEnrollment],
  ]) {
    assert.match(
      source,
      /rpc\(\s*"kandid_ensure_program_catalog_entry_for_server_actor"[\s\S]{0,180}p_actor_admin_id: actorAdminId/i,
      `${sourceName} calls the audited RPC with its server-verified admin id`,
    );
    assert.doesNotMatch(
      source,
      /from\("programs"\)[\s\S]{0,180}\.(?:insert|upsert|update|delete)\(/,
      `${sourceName} has no direct program table DML`,
    );
  }

  assert.match(boardEnrollment, /adminProfile\.role !== "electoral_board"/);
  assert.match(superAdminEnrollment, /adminProfile\.role !== "super_admin"/);
  assert.match(masterlistImport, /adminProfile\.role !== "super_admin"/);
  assert.match(
    masterlistImport,
    /kandid_review_current_term_program_changes/,
  );
  assert.match(masterlistImport, /kandid_finalize_masterlist_import_with_membership_sync/);
  assert.doesNotMatch(masterlistImport, /from\("organization_programs"\)[\s\S]{0,180}\.(?:insert|upsert|update|delete)\(/);
  assert.doesNotMatch(
    boardEnrollment,
    /from\("organization_programs"\)[\s\S]{0,180}\.(?:insert|upsert|update|delete)\(/,
    "Board enrollment cannot mutate organization coverage",
  );
});
