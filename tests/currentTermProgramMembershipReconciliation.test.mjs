import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, correctiveMigration, masterlist, submitVote] = await Promise.all([
  readFile(new URL("../supabase/migrations/20261017000000_reconcile_memberships_on_current_term_program_change.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261017100000_fix_masterlist_membership_finalizer_program_id_ambiguity.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/super-admin-masterlist-import/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/submit-vote/index.ts", import.meta.url), "utf8"),
]);

test("migration fails closed unless the trusted installed schema and finalizer contract match", () => {
  assert.match(migration, /to_regprocedure\('public\.finalize_masterlist_import\(integer\)'\) is null/i);
  assert.match(migration, /finalizer_security_definer or finalizer_owner <> 'postgres'/i);
  assert.match(migration, /has_function_privilege\('service_role', 'public\.finalize_masterlist_import\(integer\)', 'EXECUTE'\)/i);
  assert.match(migration, /Term-membership removal contract differs/i);
  assert.match(migration, /do \$postflight\$[\s\S]*?term-membership admission guard is missing or disabled/i);
  assert.match(migration, /has_function_privilege\('authenticated', 'public\.kandid_review_current_term_program_changes/i);
});

test("trusted Masterlist flow reviews same-term program shifts and finalizes with atomic membership reconciliation", () => {
  assert.match(migration, /current_term_shifted_program/i);
  assert.match(migration, /lower\(pg_catalog\.btrim\(current_enrollment\.program\)\) <> lower\(pg_catalog\.btrim\(rir\.program\)\)/i);
  assert.match(migration, /review_status = case when mir\.review_status = 'approved'/i);
  assert.match(masterlist, /kandid_review_current_term_program_changes/);
  assert.match(masterlist, /kandid_finalize_masterlist_import_with_membership_sync/);
  assert.doesNotMatch(masterlist, /adminClient\.rpc\("finalize_masterlist_import"/);
});

test("reconciliation removes only ineligible program memberships and preserves institution/manual memberships", () => {
  assert.match(migration, /set status = 'removed'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.match(migration, /not exists \([\s\S]*?public\.organization_programs op[\s\S]*?op\.program_id = program_id/i);
  assert.match(migration, /o\.membership_scope = 'institution'[\s\S]*?o\.membership_scope = 'program'/i);
  assert.doesNotMatch(migration, /membership_scope = 'manual'[\s\S]{0,160}set status/i);
  assert.match(migration, /status = 'active', source = 'system', removed_by = null/i);
  assert.match(migration, /on conflict \(student_id, organization_id\) do nothing/i);
  assert.doesNotMatch(migration, /(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.(?:votes|vote_ballots|elections|election_electorates)/i);
});

test("only the trusted service-role wrapper can reconcile; trigger requires an active Super Admin marker", () => {
  assert.match(migration, /kandid\.program_reconcile_actor_id/i);
  assert.match(migration, /a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(migration, /revoke all on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) to service_role/i);
  assert.match(migration, /revoke all on function public\.kandid_review_current_term_program_changes\(integer, bigint\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_review_current_term_program_changes\(integer, bigint\) to service_role/i);
});

test("corrective migration removes the PL/pgSQL program_id ambiguity without changing the finalizer contract", () => {
  const functionBody = correctiveMigration.slice(
    correctiveMigration.indexOf("create or replace function public.kandid_finalize_masterlist_import_with_membership_sync("),
    correctiveMigration.indexOf("alter function public.kandid_finalize_masterlist_import_with_membership_sync(integer, bigint) owner to postgres;"),
  );

  assert.match(correctiveMigration, /^begin;[\s\S]*commit;\s*$/i);
  assert.match(functionBody, /v_resolved_program_id bigint;/i);
  assert.match(functionBody, /into v_resolved_program_id/i);
  assert.match(functionBody, /if v_resolved_program_id is null then/i);
  assert.equal((functionBody.match(/op\.program_id\s*=\s*v_resolved_program_id/gi) ?? []).length, 2);
  assert.doesNotMatch(functionBody, /\bprogram_id\s+bigint\s*;/i);
  assert.doesNotMatch(functionBody, /op\.program_id\s*=\s*program_id\b/i);
  assert.match(functionBody, /language plpgsql\s+security definer\s+set search_path = pg_catalog/i);
  assert.match(correctiveMigration, /owner to postgres/i);
  assert.match(correctiveMigration, /revoke all on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) from public, anon, authenticated, service_role/i);
  assert.match(correctiveMigration, /grant execute on function public\.kandid_finalize_masterlist_import_with_membership_sync\(integer, bigint\) to service_role/i);
  assert.match(correctiveMigration, /function_search_path not like '%search_path=pg_catalog%'/i);
  assert.match(correctiveMigration, /public_execute_grant/i);
  assert.doesNotMatch(correctiveMigration, /create\s+(?:or replace\s+)?function\s+(?!public\.kandid_finalize_masterlist_import_with_membership_sync)/i);
});

test("frozen-electorate vote submission also requires current organization participation", () => {
  const frozenBranch = submitVote.slice(
    submitVote.indexOf("if (Number(election.electorate_policy_version) === 1)"),
    submitVote.indexOf("} else if (Number(election.electorate_policy_version) === 0)"),
  );
  assert.match(frozenBranch, /resolve_student_organization_participation/);
  assert.match(frozenBranch, /participation\?\.allowed !== true/);
  assert.ok(frozenBranch.indexOf("resolve_student_organization_participation") < frozenBranch.indexOf("kandid_is_locked_electorate_member"));
});
