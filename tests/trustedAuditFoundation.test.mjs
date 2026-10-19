import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20261002130000_trusted_audit_foundation.sql", root), "utf8");
const helper = await readFile(new URL("src/utils/auditLog.js", root), "utf8");
const boardEnrollment = await readFile(new URL("supabase/functions/board-manual-enrollment/index.ts", root), "utf8");
const superAdminEnrollment = await readFile(new URL("supabase/functions/super-admin-manual-enrollment/index.ts", root), "utf8");
const superAdminImport = await readFile(new URL("supabase/functions/super-admin-masterlist-import/index.ts", root), "utf8");
const programCoverage = await readFile(new URL("supabase/migrations/20261002110000_secure_organization_program_coverage.sql", root), "utf8");

test("ordinary clients cannot read or write audit_logs directly", () => {
  assert.match(migration, /alter table public\.audit_logs enable row level security/i);
  assert.match(migration, /revoke all on table public\.audit_logs from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant insert on table public\.audit_logs to service_role/i);
  assert.match(migration, /revoke all on sequence public\.audit_logs_id_seq from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete|all).*audit_logs\s+to\s+(public|anon|authenticated)/i);
  assert.doesNotMatch(helper, /from\(["']audit_logs["']\)\.insert/);
  assert.match(helper, /Compatibility shim[\s\S]*Browser code is never an audit writer/);
});

test("migration expands the verified four-column production table before dependents", () => {
  const legacyColumns = [
    "actor_name text", "actor_role text", "created_at timestamptz", "entity_id text",
    "entity_label text", "entity_type text", "metadata jsonb", "organization_id bigint",
    "organization_name text", "status text",
  ];
  const baseAlter = migration.indexOf("alter table public.audit_logs");
  const firstIndex = migration.indexOf("create index");
  const firstFunction = migration.indexOf("create or replace function");
  assert.ok(baseAlter >= 0 && firstIndex > baseAlter && firstFunction > firstIndex);
  for (const column of legacyColumns) {
    assert.match(migration, new RegExp(`add column if not exists ${column.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, "i"));
  }
  assert.doesNotMatch(migration, /alter table public\.audit_logs[\s\S]*?add column if not exists (?:actor_name|actor_role|created_at|entity_id|entity_label|entity_type|metadata|organization_id|organization_name|status) [^,;]+ not null/i);
  assert.doesNotMatch(migration, /(?:drop|create) table public\.audit_logs|delete from public\.audit_logs|update public\.audit_logs/i);
});

test("legacy four-column rows and sparse service-role inserts remain valid and distinguishable", () => {
  const prepare = migration.match(/create or replace function public\.kandid_prepare_audit_event\(\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$/i)?.[1] || "";
  assert.match(migration, /created_at remains NULL on old rows/i);
  assert.match(prepare, /new\.event_type := case normalized/i);
  assert.match(prepare, /new\.event_category := coalesce/i);
  assert.match(prepare, /new\.timestamp := pg_catalog\.clock_timestamp\(\)/i);
  assert.match(prepare, /new\.created_at := new\.timestamp/i);
  assert.doesNotMatch(prepare, /new\.(?:actor_name|actor_role|organization_id|organization_name|entity_id|entity_type|entity_label|metadata|status)\s*:=\s*(?!null)/i);
  assert.match(migration, /'is_legacy', p\.event_origin is null/i);
  assert.match(migration, /coalesce\(l\.created_at, l\.timestamp\)/i);
  assert.match(migration, /grant insert on table public\.audit_logs to service_role/i);
  assert.match(migration, /grant usage on sequence public\.audit_logs_id_seq to service_role/i);
});

test("updated Edge Function audit writes target columns installed by this migration", () => {
  const commonColumns = [
    "user_id", "actor_name", "actor_role", "action", "event_type", "event_category", "event_origin",
    "entity_type", "entity_id", "entity_label", "status", "metadata",
  ];
  for (const [source, includesOrganization, conditionalOrganization] of [
    [boardEnrollment, true, false],
    [superAdminEnrollment, false, true],
    [superAdminImport, false, false],
  ]) {
    const insert = source.match(/from\("audit_logs"\)\.insert\(\{([\s\S]*?)\}\)/)?.[1] || "";
    assert.ok(insert, "Expected trusted audit_logs insert in each updated Edge Function");
    for (const column of commonColumns) {
      assert.match(insert, column === "metadata" ? /\bmetadata(?:\s*:|\s*,)/ : new RegExp(`\\b${column}:`));
    }
    for (const column of ["organization_id", "organization_name"]) {
      if (includesOrganization) assert.match(insert, new RegExp(`\\b${column}:`));
      else if (conditionalOrganization) {
        assert.match(insert, /\.\.\.organizationAuditContext\(event\)/);
      } else assert.doesNotMatch(insert, new RegExp(`\\b${column}:`));
    }
  }
  assert.match(superAdminEnrollment, /function organizationAuditContext\(event[\s\S]*?if \(!event\.organizationId\) return \{\}[\s\S]*?organization_id: event\.organizationId[\s\S]*?organization_name: event\.organizationName/);
  for (const column of ["actor_name", "actor_role", "created_at", "entity_id", "entity_label", "entity_type", "metadata", "organization_id", "organization_name", "status"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`, "i"));
  }
});

test("legacy rows cannot leak into Board organization results through NULL organization IDs", () => {
  const boardBody = migration.match(/create or replace function public\.kandid_list_board_audit_events\([\s\S]*?as \$function\$([\s\S]*?)\$function\$/i)?.[1] || "";
  const superAdminBody = migration.match(/create or replace function public\.kandid_list_super_admin_audit_events\([\s\S]*?as \$function\$([\s\S]*?)\$function\$/i)?.[1] || "";
  assert.match(boardBody, /where l\.organization_id = board_org_id/i);
  assert.match(boardBody, /'is_legacy', p\.event_origin is null/i);
  assert.match(superAdminBody, /'is_legacy', p\.event_origin is null/i);
  assert.match(superAdminBody, /where \(p_organization_id is null or l\.organization_id = p_organization_id\)/i);
});

test("Board read RPC derives one active organization from auth.uid and accepts no organization input", () => {
  const signature = migration.match(/create or replace function public\.kandid_list_board_audit_events\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] || "";
  const body = migration.match(/create or replace function public\.kandid_list_board_audit_events\([\s\S]*?as \$function\$([\s\S]*?)\$function\$/i)?.[1] || "";
  assert.doesNotMatch(signature, /organization/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /a\.role = 'electoral_board' and a\.status = 'active'/i);
  assert.match(body, /assignment_count <> 1/);
  assert.match(body, /caller_uid is null/i);
  assert.match(body, /where l\.organization_id = board_org_id/i);
  assert.match(migration, /grant execute on function public\.kandid_list_board_audit_events\([\s\S]*?to authenticated/i);
  assert.match(migration, /revoke all on function public\.kandid_list_board_audit_events\([\s\S]*?from public, anon, authenticated/i);
});

test("Super Admin reads use a distinct trusted global contract", () => {
  const signature = migration.match(/create or replace function public\.kandid_list_super_admin_audit_events\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] || "";
  const body = migration.match(/create or replace function public\.kandid_list_super_admin_audit_events\([\s\S]*?as \$function\$([\s\S]*?)\$function\$/i)?.[1] || "";
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /a\.role = 'super_admin' and a\.status = 'active'/i);
  assert.match(body, /assignment_count <> 1/);
  assert.match(signature, /p_entity_type text default null[\s\S]*?p_status text default null[\s\S]*?p_created_on date default null/);
  assert.match(body, /coalesce\(l\.created_at, l\.timestamp\) at time zone 'UTC'/i);
  assert.match(migration, /grant execute on function public\.kandid_list_super_admin_audit_events\([\s\S]*?to authenticated/i);
  const signatureTypes = "timestamptz, bigint, integer, text, text, bigint, bigint, text, text, text, date";
  assert.match(migration, new RegExp(`revoke all on function public\\.kandid_list_super_admin_audit_events\\(${signatureTypes.replaceAll(", ", ",\\s*")}\\)`));
  assert.match(migration, new RegExp(`grant execute on function public\\.kandid_list_super_admin_audit_events\\(${signatureTypes.replaceAll(", ", ",\\s*")}\\)`));
});

test("read contracts use keyset pagination and return an allow-listed projection only", () => {
  assert.equal((migration.match(/p_before_created_at timestamptz default null/g) || []).length, 2);
  assert.match(migration, /\(coalesce\(l\.created_at, l\.timestamp\), l\.id\) < \(p_before_created_at, p_before_id\)/);
  assert.match(migration, /'has_more', \(select count\(\*\) > page_limit from filtered\)/i);
  assert.match(migration, /'changed_fields', p\.changed_fields, 'safe_details', p\.safe_details/);
  assert.doesNotMatch(migration, /'metadata'\s*,\s*l\.metadata/i);
  assert.doesNotMatch(migration, /ballot_contents|vote_hash|transaction_hash|nonce|receipt_secret/i);
});

test("trusted row triggers cover consequential Board CRUD and stable event types", () => {
  const mutationTriggers = {
    elections: "audit_elections_mutations",
    positions: "audit_positions_mutations",
    candidates: "audit_candidates_mutations",
    partylists: "audit_partylists_mutations",
    eligibility_rules: "audit_eligibility_rules_mutations",
    officers: "audit_officers_mutations",
    officer_new_roster: "audit_officer_new_roster_mutations",
    officer_leadership_releases: "audit_officer_release_mutations",
    students: "audit_students_mutations",
    student_organizations: "audit_student_organization_memberships",
  };
  for (const [table, trigger] of Object.entries(mutationTriggers)) {
    assert.match(migration, new RegExp(`create trigger ${trigger} after insert or update or delete on public\\.${table}`, "i"));
  }
  for (const eventType of [
    "election_created", "election_updated", "election_deleted", "election_status_changed", "results_published",
    "position_created", "position_updated", "position_deleted", "position_retired",
    "candidate_created", "candidate_updated", "candidate_removed", "candidate_status_changed",
    "partylist_created", "partylist_updated", "partylist_removed",
    "eligibility_rule_created", "eligibility_rule_updated", "eligibility_rule_removed",
    "officer_current_added", "officer_elected_staged", "officer_appointed_staged", "officer_roster_released",
  ]) assert.ok(migration.includes(`'${eventType}'`), `Missing ${eventType}`);
  assert.match(migration, /admin_users a[\s\S]*?where a\.auth_user_id = caller_uid[\s\S]*?a\.status = 'active'/i);
  assert.match(migration, /admin_row\.role = 'electoral_board'[\s\S]*?admin_row\.organization_id/i);
  assert.match(migration, /clock_timestamp\(\)/i);
});

test("representative create, edit, and delete mutations are captured by one trusted row trigger", () => {
  for (const tableEvents of [
    ["elections", "election_created", "election_updated", "election_deleted"],
    ["positions", "position_created", "position_updated", "position_deleted"],
    ["candidates", "candidate_created", "candidate_updated", "candidate_removed"],
  ]) {
    assert.ok(migration.includes(`tg_table_name = '${tableEvents[0]}'`));
    for (const event of tableEvents.slice(1)) assert.ok(migration.includes(`'${event}'`));
  }
  assert.match(migration, /after insert or update or delete on public\.elections/i);
  assert.match(migration, /after insert or update or delete on public\.positions/i);
  assert.match(migration, /after insert or update or delete on public\.candidates/i);
});

test("browser logging compatibility callers do not create a duplicate event", () => {
  assert.match(helper, /logAuditEvent[\s\S]*?return \{ error: null, skipped: true \}/);
  assert.doesNotMatch(helper, /\.from\(["']audit_logs["']\)\s*\.insert/);
  assert.match(migration, /create trigger audit_candidates_mutations after insert or update or delete on public\.candidates/i);
});

test("Edge enrollment and membership events attribute the authenticated Board actor", () => {
  assert.match(boardEnrollment, /\.select\("id, auth_user_id, full_name, role, status, organization_id"\)/);
  assert.match(boardEnrollment, /actor_role: "electoral_board"/);
  assert.match(boardEnrollment, /event_origin: "trusted_edge"/);
  assert.match(boardEnrollment, /eventType: "student_batch_imported"/);
  assert.match(boardEnrollment, /eventType: action === "remove" \? "membership_removed" : "membership_restored"/);
  assert.match(boardEnrollment, /audit_record_failed/);
  assert.match(migration, /auth\.uid\(\) is null and new\.action in \([\s\S]*?Student Removed from Organization[\s\S]*?Student Restored to Organization/i);
});

test("trusted Super Admin enrollment and finalized imports record safe attributable events", () => {
  assert.match(superAdminEnrollment, /select\("id, auth_user_id, full_name, role, status"\)/);
  assert.match(superAdminEnrollment, /actor_role: "super_admin"/);
  assert.match(superAdminEnrollment, /eventType: "student_term_enrolled"/);
  assert.match(superAdminEnrollment, /event_origin: "trusted_edge"/);
  assert.match(superAdminImport, /select\("id, auth_user_id, full_name, role, status"\)/);
  assert.match(superAdminImport, /event_type: "student_batch_imported"/);
  assert.match(superAdminImport, /event_origin: "trusted_edge"/);
  assert.match(superAdminImport, /membership_synced_count: membershipResult\.syncedCount/);
  assert.match(superAdminEnrollment, /audit_record_failed/);
  assert.match(superAdminImport, /audit_record_failed/);
});

test("student records and organization membership changes have trusted audit coverage", () => {
  assert.match(migration, /create trigger audit_students_mutations after insert or update or delete on public\.students/i);
  assert.match(migration, /create trigger audit_student_organization_memberships after insert or update or delete on public\.student_organizations/i);
  assert.match(migration, /event_type_value := 'student_created'/);
  assert.match(migration, /event_type_value := 'student_updated'/);
  assert.match(migration, /event_type_value := 'student_deleted'/);
  assert.match(migration, /event_type_value := 'membership_added'/);
  assert.match(migration, /event_type_value := 'membership_removed'/);
  assert.match(migration, /'first_name', 'last_name', 'program', 'year_level'/);
  assert.doesNotMatch(migration, /jsonb_build_object\(['"](password|token|student_number|vote|ballot)/i);
});

test("legacy audit rows stay distinguishable and are not backfilled", () => {
  assert.match(migration, /add column if not exists event_origin text/i);
  assert.match(migration, /'is_legacy', p\.event_origin is null/i);
  assert.doesNotMatch(migration, /update public\.audit_logs/i);
});

test("existing trusted program coverage/catalog auditing remains intact", () => {
  assert.match(programCoverage, /'program_catalog_entry_created'/);
  assert.match(programCoverage, /'organization_program_coverage_replaced'/);
  assert.match(programCoverage, /before_programs/);
  assert.match(programCoverage, /after_programs/);
  assert.match(migration, /'organization_program_coverage_changed'/);
});
