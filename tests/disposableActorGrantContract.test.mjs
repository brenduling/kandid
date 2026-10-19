import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql', import.meta.url),
  'utf8',
);
const privilegeBaseline = readFileSync(
  new URL('../supabase/migrations/20261012000000_release_sensitive_table_access_hardening.sql', import.meta.url),
  'utf8',
);
const harness = readFileSync(
  new URL('../scripts/kandid-disposable-migration-rollback-test.ps1', import.meta.url),
  'utf8',
);

test('candidate student link is denied while authenticated candidate display columns stay available', () => {
  assert.match(migration, /revoke select on table public\.candidates from public, anon, authenticated/i);
  assert.match(migration, /revoke select \(%I\) on table public\.candidates from public, anon, authenticated/i);
  const candidateGrant = migration.match(/grant select\s*\(([^)]+)\)\s*on public\.candidates to authenticated/i);
  assert.ok(candidateGrant, 'expected the reviewed authenticated candidate projection');
  assert.doesNotMatch(candidateGrant[1], /\bstudent_id\b/i);
  assert.match(harness, /has_column_privilege\('authenticated','public\.candidates','student_id','SELECT'\) then\s+raise exception 'ACTOR_STUDENT_CANDIDATE_STUDENT_ID_COLUMN_GRANT_PRESENT'/i);
  assert.match(migration, /grant execute on function public\.kandid_admin_candidate_directory\(integer\[\],integer\[\]\) to authenticated/i);
  assert.match(migration, /a\.auth_user_id=caller_uid and a\.status='active'[\s\S]*?a\.role in \('super_admin','electoral_board'\)/i);
  assert.match(migration, /private\.kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
});

test('authenticated election-token SELECT remains role- and organization-scoped by RLS', () => {
  assert.match(privilegeBaseline, /grant select on table public\.election_access_tokens to authenticated/i);
  assert.match(privilegeBaseline, /create policy election_access_tokens_read_admin_scope[\s\S]*?using\s*\([\s\S]*?a\.status\s*=\s*'active'[\s\S]*?a\.role\s*=\s*'electoral_board'[\s\S]*?a\.organization_id\s*=\s*e\.organization_id/i);
  assert.doesNotMatch(harness, /has_table_privilege\('authenticated','public\.election_access_tokens','SELECT'\)/i);
  assert.match(harness, /select count\(\*\) into visible_count from public\.election_access_tokens;\s*if visible_count<>0 then raise exception 'ACTOR_STUDENT_ELECTION_ACCESS_TOKEN_VISIBLE'/i);
});

test('Board A cross-organization assertion runs as authenticated with Board A claims', () => {
  assert.match(harness, /select 'STUDENT=PASS';\s*reset role;\s*delete from public\.candidates[^;]*;\s*set local role authenticated;\s*do \$actor_board_a\$/i);
  assert.match(harness, /do \$actor_board_a\$[\s\S]*?if current_user <> 'authenticated' then raise exception 'ACTOR_BOARD_A_ROLE_SIMULATION_INVALID'; end if;[\s\S]*?set_config\('request\.jwt\.claim\.sub',current_setting\('kandid\.test\.board_a_uid'\),true\)[\s\S]*?select count\(\*\) into visible_count from public\.elections where organization_id<>current_setting\('kandid\.test\.board_a_org'\)::integer;\s*if visible_count<>0 then raise exception 'ACTOR_BOARD_A_CROSS_ORGANIZATION_READ'/i);
  assert.match(migration, /create policy elections_authenticated_scoped_read on public\.elections for select to authenticated\s+using\s*\([\s\S]*?private\.kandid_active_admin_can_access_organization\(organization_id\)/i);
});


test('Board report fixture checks its own zero-vote candidate independent of position order and diagnoses missing versus nonzero totals', () => {
  const boardA = harness.match(/do \$actor_board_a\$([\s\S]*?)\$actor_board_a\$;/i)?.[1] || '';
  assert.ok(boardA);
  assert.match(boardA, /select candidate_item\.candidate_json->>'vote_total'[\s\S]*?candidate_id'=current_setting\('kandid\.test\.board_candidate_id'\)[\s\S]*?if not found then[\s\S]*?actual_candidate=ABSENT/i);
  assert.match(boardA, /actual_candidate_id=% actual_vote_total=% actor=BoardA invoking_role=%/i);
  assert.match(boardA, /actual_candidate_vote_total is distinct from '0'/i);
  assert.doesNotMatch(boardA, /candidate_json->>'candidate_name'|candidate_json->>'student_id'/i);
});

test('Board B private-data denial excludes the deliberately public released archive and accepts scoped empty RPC results', () => {
  const boardB = harness.match(/do \$actor_board_b\$([\s\S]*?)\$actor_board_b\$;/i)?.[1] || '';
  assert.ok(boardB);
  assert.doesNotMatch(boardB, /current_setting\('kandid\.test\.e_a'\)::integer/);
  assert.match(boardB, /current_setting\('kandid\.test\.e_a_archived_private'\)[\s\S]*?current_setting\('kandid\.test\.e_a_pre'\)[\s\S]*?current_setting\('kandid\.test\.e_a_draft'\)/i);
  assert.match(boardB, /select count\(\*\) into visible_count\s+from public\.kandid_admin_candidate_directory\([\s\S]*?if visible_count<>0 then raise exception 'ACTOR_BOARD_B_FOREIGN_CANDIDATE_DIRECTORY_ALLOWED'/i);
  assert.doesNotMatch(boardB, /perform public\.kandid_admin_candidate_directory[\s\S]*?raise exception 'ACTOR_BOARD_B_FOREIGN_CANDIDATE_DIRECTORY_ALLOWED'/i);
});

test('Super Admin actor verifies system-wide visibility including draft management records', () => {
  const superAdmin = harness.match(/do \$actor_super_admin\$([\s\S]*?)\$actor_super_admin\$;/i)?.[1] || '';
  assert.ok(superAdmin);
  assert.match(superAdmin, /current_setting\('kandid\.test\.e_a_draft'\)[\s\S]*?visible_count<>5/i);
});
