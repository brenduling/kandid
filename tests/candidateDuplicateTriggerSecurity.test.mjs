import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql', import.meta.url),
  'utf8',
);
const eligibility = readFileSync(
  new URL('../supabase/migrations/20261021100000_candidate_eligibility_uses_election_term.sql', import.meta.url),
  'utf8',
);
const harness = readFileSync(
  new URL('../scripts/kandid-disposable-migration-rollback-test.ps1', import.meta.url),
  'utf8',
);

test('duplicate trigger uses an isolated, least-privilege definer role', () => {
  assert.match(migration, /prevent_duplicate_candidate_per_election\(\)'::pg_catalog\.regprocedure[\s\S]*?proowner=\(select oid from pg_catalog\.pg_roles where rolname='postgres'\)[\s\S]*?not p\.prosecdef[\s\S]*?p\.proconfig=array\['search_path=public, pg_temp'\]::text\[\]/i);
  assert.match(migration, /t\.tgname='candidates_one_student_per_election_guard'[\s\S]*?t\.tgenabled='O'/i);
  assert.match(migration, /create role kandid_candidate_duplicate_checker with\s+nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/i);
  assert.match(migration, /execute 'alter function public\.prevent_duplicate_candidate_per_election\(\) owner to kandid_candidate_duplicate_checker'/i);
  assert.match(migration, /create or replace function public\.prevent_duplicate_candidate_per_election\(\)[\s\S]*?security definer\s+set search_path = pg_catalog/i);
  assert.match(migration, /revoke all on function public\.prevent_duplicate_candidate_per_election\(\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select \(id, organization_id\) on public\.elections to kandid_candidate_duplicate_checker/i);
  assert.match(migration, /grant select \(id, election_id, name\) on public\.positions to kandid_candidate_duplicate_checker/i);
  assert.match(migration, /grant select \(id, student_id, position_id\) on public\.candidates to kandid_candidate_duplicate_checker/i);
  assert.match(migration, /has_schema_privilege\('kandid_candidate_duplicate_checker','public','CREATE'\)/i);
  assert.match(migration, /pg_auth_members m[\s\S]*?where \(m\.roleid=checker_oid or m\.member=checker_oid\)[\s\S]*?m\.admin_option and not m\.inherit_option and not m\.set_option/i);
  assert.match(migration, /has_table_privilege\('kandid_candidate_duplicate_checker','public\.candidates','SELECT'\)/i);
});

test('function ownership transfer grants and immediately removes only temporary capabilities', () => {
  const transfer = migration.match(/do \$transfer_candidate_checker_ownership\$([\s\S]*?)\$transfer_candidate_checker_ownership\$;/i)?.[1];
  assert.ok(transfer);
  const statements = [
    "execute 'grant create on schema public to kandid_candidate_duplicate_checker'",
    "execute 'grant kandid_candidate_duplicate_checker to current_user with inherit false, set true'",
    "execute 'alter function public.prevent_duplicate_candidate_per_election() owner to kandid_candidate_duplicate_checker'",
    "execute 'revoke create on schema public from kandid_candidate_duplicate_checker'",
    "execute 'revoke kandid_candidate_duplicate_checker from current_user'",
  ];
  const offsets = statements.map((statement) => transfer.toLowerCase().indexOf(statement));
  assert.ok(offsets.every((offset) => offset >= 0));
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
  assert.match(transfer, /has_schema_privilege\('kandid_candidate_duplicate_checker','public','create'\)/i);
  assert.match(transfer, /pg_auth_members[\s\S]*?roleid=\(select oid from pg_catalog\.pg_roles where rolname='kandid_candidate_duplicate_checker'\)[\s\S]*?member=\(select oid from pg_catalog\.pg_roles where rolname='kandid_candidate_duplicate_checker'\)/i);
  assert.match(transfer, /m\.admin_option and not m\.inherit_option and not m\.set_option/i);
  assert.match(transfer, /pg_has_role\(current_user,'kandid_candidate_duplicate_checker','set'\)/i);
  assert.match(transfer, /pg_has_role\('authenticated','kandid_candidate_duplicate_checker','set'\)/i);
});

test('PostgreSQL 17 creator ADMIN-only membership is distinguished from SET ROLE access', () => {
  assert.match(migration, /current_setting\('createrole_self_grant'\) <> ''/i);
  assert.match(migration, /creator\.rolcreaterole and not creator\.rolsuper/i);
  assert.match(migration, /g\.rolsuper/i);
  assert.match(migration, /not m\.inherit_option and not m\.set_option/i);
  assert.match(harness, /m\.grantor::text[\s\S]*?m\.inherit_option::text[\s\S]*?m\.set_option::text/i);
  assert.match(harness, /pg_has_role\(current_user,'kandid_candidate_duplicate_checker','set'\)/i);
});

test('function ACL is hardened before the restricted owner transfer', () => {
  const aclRevoke = migration.search(/revoke all on function public\.prevent_duplicate_candidate_per_election\(\) from public, anon, authenticated, service_role/i);
  const transfer = migration.search(/do \$transfer_candidate_checker_ownership\$/i);
  const postflight = migration.search(/do \$duplicate_checker_postflight\$/i);
  assert.ok(aclRevoke >= 0 && transfer > aclRevoke && postflight > transfer);
  assert.ok(migration.indexOf('$function$;', migration.indexOf('create or replace function public.prevent_duplicate_candidate_per_election()')) < aclRevoke);
  assert.doesNotMatch(migration.slice(transfer, postflight), /\b(?:grant|revoke)\s+(?:all\s+)?on function public\.prevent_duplicate_candidate_per_election/i);
  assert.match(migration, /has_function_privilege\('authenticated','public\.prevent_duplicate_candidate_per_election\(\)','execute'\)/i);
  assert.match(migration, /has_function_privilege\('anon','public\.prevent_duplicate_candidate_per_election\(\)','execute'\)/i);
});

test('checker RLS remains restricted to an active assigned Board or Super Admin', () => {
  assert.match(migration, /create policy elections_candidate_duplicate_checker_read[\s\S]*?private\.kandid_active_admin_can_access_organization\(organization_id\)/i);
  assert.match(migration, /create policy positions_candidate_duplicate_checker_read[\s\S]*?private\.kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
  assert.match(migration, /create policy candidates_candidate_duplicate_checker_read[\s\S]*?private\.kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
  const triggerFn = migration.match(/create or replace function public\.prevent_duplicate_candidate_per_election\(\)([\s\S]*?)\$function\$;/i)?.[1];
  assert.ok(triggerFn);
  assert.ok(triggerFn.indexOf('public.kandid_can_mutate_election_positions') < triggerFn.indexOf('from public.candidates c'));
  assert.match(triggerFn, /pg_catalog\.pg_advisory_xact_lock\(target_election_id,new\.student_id\)/i);
  assert.match(eligibility, /create or replace function public\.kandid_guard_candidate_mutation\(\)[\s\S]*?security definer[\s\S]*?not public\.kandid_can_mutate_election_positions\(new_election_id\)/i);
});

test('migration executors are rejected before DDL when role, schema, table, or function authority is insufficient', () => {
  const preflight = migration.match(/do \$preflight\$([\s\S]*?)\$preflight\$;/i)?.[1];
  const eligibilityPreflight = eligibility.match(/do \$preflight\$([\s\S]*?)\$preflight\$;/i)?.[1];
  assert.ok(preflight);
  assert.ok(eligibilityPreflight);
  const firstMigrationDdl = migration.indexOf('create or replace function private.kandid_active_admin_can_access_organization');
  const firstEligibilityDdl = eligibility.indexOf('create or replace function public.kandid_guard_candidate_mutation');
  assert.ok(firstMigrationDdl > migration.indexOf('$preflight$;'));
  assert.ok(firstEligibilityDdl > eligibility.indexOf('$preflight$;'));
  assert.match(preflight, /rolsuper or r\.rolcreaterole/i);
  assert.match(preflight, /has_schema_privilege\(current_user,'public','create'\)/i);
  assert.match(preflight, /p\.proowner<>\(select r\.oid from pg_catalog\.pg_roles r where r\.rolname=current_user\)/i);
  assert.match(preflight, /SECURITY DEFINER data access context/i);
  assert.match(preflight, /current_user <> 'postgres'/i);
  assert.match(preflight, /pg_has_role\(current_user,[\s\S]*?'public\.kandid_can_mutate_election_positions\(integer\)'[\s\S]*?'usage'/i);
  assert.match(eligibilityPreflight, /has_schema_privilege\(current_user, 'public', 'create'\)/i);
  assert.match(eligibilityPreflight, /pg_has_role\(current_user,[\s\S]*?'set'/i);
  assert.match(eligibilityPreflight, /current_user <> 'postgres'/i);
});

test('post-transfer statements do not attempt ACL changes as the restricted checker owner', () => {
  const transferEnd = migration.indexOf('$transfer_candidate_checker_ownership$;', migration.indexOf('do $transfer_candidate_checker_ownership$'));
  const functionEnd = migration.indexOf('$postflight$;', migration.indexOf('do $duplicate_checker_postflight$'));
  assert.ok(transferEnd > 0 && functionEnd > transferEnd);
  const afterTransfer = migration.slice(transferEnd, functionEnd);
  assert.doesNotMatch(afterTransfer, /\b(?:grant|revoke)\s+(?:all\s+)?on function public\.prevent_duplicate_candidate_per_election/i);
  const aclRevoke = migration.indexOf('revoke all on function public.prevent_duplicate_candidate_per_election()');
  assert.ok(aclRevoke > 0 && aclRevoke < migration.indexOf('do $transfer_candidate_checker_ownership$'));
});

test('Student direct campaign reads obey the same scheduled publication window and partylist projection is narrow', () => {
  assert.match(migration, /candidates\.campaign_status='published'[\s\S]*?kandid_student_can_read_election\(e\.id\)[\s\S]*?e\.campaign_start is not null and e\.campaign_end is not null[\s\S]*?statement_timestamp\(\)[\s\S]*?e\.campaign_end/i);
  assert.match(migration, /partylists_authenticated_scoped_read[\s\S]*?e\.campaign_start is not null and e\.campaign_end is not null[\s\S]*?statement_timestamp\(\)/i);
  assert.match(migration, /revoke select on table public\.partylists from public, anon, authenticated[\s\S]*?grant select \(id, organization_id, election_id, name, description, logo_url\)\s+on public\.partylists to authenticated/i);
  assert.match(migration, /Partylist browser SELECT grants differ from the reviewed column projection/i);
  assert.match(migration, /create or replace function private\.kandid_board_can_read_candidate_student\([\s\S]*?p_student_id integer[\s\S]*?security definer\s+set search_path = pg_catalog[\s\S]*?c\.student_id=p_student_id[\s\S]*?a\.organization_id=e\.organization_id/i);
  const studentPolicy = migration.match(/create policy students_release_safe_select[\s\S]*?\);/i)?.[0];
  assert.ok(studentPolicy);
  assert.match(studentPolicy, /kandid_board_can_read_candidate_student\(students\.id\)/i);
  assert.doesNotMatch(studentPolicy, /public\.candidates\s+c/i);
});

test('RLS migration rejects permissive ALL and unreviewed mutation policies before replacing read policies', () => {
  const preflight = migration.match(/do \$preflight\$([\s\S]*?)\$preflight\$;/i)?.[1];
  assert.ok(preflight);
  assert.match(preflight, /p\.cmd='ALL'/i);
  assert.match(preflight, /Affected-table mutation policy inventory differs from the reviewed authorization baseline/i);
  for (const name of [
    'elections_update_active_admin_scope',
    'positions_insert_authorized_election',
    'candidates_insert_authorized_election',
    'partylists_update_authorized_organization',
  ]) assert.match(preflight, new RegExp(name));
});

test('rollback harness validates executor ordering, rollback-only boundaries, and post-rollback snapshots', () => {
  assert.match(harness, /CHECKER_FUNCTION_ACL_OWNERSHIP_ORDER_INVALID/);
  assert.match(harness, /CHECKER_FUNCTION_ACL_CHANGE_AFTER_OWNERSHIP_TRANSFER/);
  assert.match(harness, /MIGRATION_EXECUTOR_PREFLIGHT_CONTRACT_MISSING/);
  assert.match(harness, /GENERATED_SQL_TRANSACTION=one BEGIN \/ zero COMMIT \/ one ROLLBACK/);
  assert.match(harness, /if \(\$begins -ne 1 -or \$commits -ne 0 -or \$rollbacks -ne 1\)/);
  assert.match(harness, /ROLLBACK_POSTCHECK_CATALOG_DIFFERS/);
  assert.match(harness, /ROLLBACK_POSTCHECK_DATA_DIFFERS/);
  assert.match(harness, /Get-ReviewedMigrationBody/);
});

test('actor harness exercises authorized registration, duplicates, and foreign-Board denial', () => {
  assert.match(harness, /insert into public\.candidates\(id,position_id,student_id,campaign_status\)\s+values \(new_candidate,[\s\S]*?ACTOR_BOARD_A_OWN_CANDIDATE_UPDATE_DENIED/i);
  assert.match(harness, /ACTOR_BOARD_DUPLICATE_CANDIDATE_ERROR_CONTRACT_INVALID[\s\S]*?ACTOR_BOARD_DUPLICATE_CANDIDATE_ALLOWED/i);
  assert.match(harness, /ACTOR_BOARD_FOREIGN_CANDIDATE_DENIAL_CONTRACT_INVALID[\s\S]*?ACTOR_BOARD_FOREIGN_CANDIDATE_INSERT_ALLOWED/i);
  assert.match(harness, /BOARD_DUPLICATE_PREVENTION=PASS/);
  assert.match(harness, /BOARD_UNAUTHORIZED_CANDIDATE_DENIAL=PASS/);
  assert.match(harness, /candidate_duplicate_checker_role[\s\S]*?pg_auth_members/i);
});
