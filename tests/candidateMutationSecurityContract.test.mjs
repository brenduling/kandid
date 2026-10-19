import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260928140000_harden_candidate_mutations.sql",
  "utf8",
);
const electionAuthorityMigration = readFileSync(
  "supabase/migrations/20260928130000_harden_board_position_mutations.sql",
  "utf8",
);
const candidateManagement = readFileSync(
  "src/components/CandidateManagement.jsx",
  "utf8",
);
const superAdminPositions = readFileSync(
  "src/pages/superadmin/Positions.jsx",
  "utf8",
);

function functionDefinition(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(`create or replace function public\\.${escapedName}\\([\\s\\S]*?\\$function\\$;`, "i"),
  );
  assert.ok(match, `Expected a definition for public.${name}`);
  return match[0];
}

const guard = functionDefinition("kandid_guard_candidate_mutation");

test("migration is a single transactional forward migration", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /\b(insert into|delete from|truncate)\b/i);
});

test("public candidate reads remain while mutation policies require authenticated election authority", () => {
  assert.match(migration, /drop policy if exists candidates_all_access on public\.candidates/i);
  assert.match(migration, /drop policy if exists "open candidates" on public\.candidates/i);
  assert.match(migration, /for select\s+to anon, authenticated\s+using \(true\)/i);
  assert.match(migration, /for insert\s+to authenticated\s+with check \([\s\S]*?kandid_can_mutate_election_positions\(p\.election_id\)/i);
  assert.match(migration, /for update\s+to authenticated\s+using \([\s\S]*?kandid_can_mutate_election_positions\(p\.election_id\)[\s\S]*?with check \([\s\S]*?kandid_can_mutate_election_positions\(p\.election_id\)/i);
  assert.match(migration, /for delete\s+to authenticated\s+using \([\s\S]*?kandid_can_mutate_election_positions\(p\.election_id\)/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete)\s+to anon/i);
});

test("candidate authorization is derived from OLD and NEW position elections", () => {
  assert.match(guard, /select p\.election_id\s+into old_election_id[\s\S]*?kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(guard, /select p\.election_id, e\.organization_id\s+into new_election_id, new_organization_id/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(guard, /if old\.position_id is null and new\.position_id is null then[\s\S]*?raise exception/i);
  assert.match(guard, /detaching a candidate may only clear its ballot position/i);
  assert.match(guard, /if new\.position_id is not null then[\s\S]*?kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(guard, /if old\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(migration, /position_id is null\s+or exists \([\s\S]*?kandid_can_mutate_election_positions/i);
  assert.match(migration, /position_id is not null\s+and exists \([\s\S]*?kandid_can_mutate_election_positions/i);
});

test("legitimate assigned workflows use the existing Board and Super Admin election authority", () => {
  assert.match(electionAuthorityMigration, /caller_uid\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(electionAuthorityMigration, /a\.role\s*=\s*'electoral_board'[\s\S]*?a\.organization_id\s*=\s*e\.organization_id/i);
  assert.match(electionAuthorityMigration, /a\.role\s*=\s*'super_admin'[\s\S]*?a\.status\s*=\s*'active'/i);
  assert.match(guard, /if old\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(guard, /if new\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(guard, /new\.position_id is null[\s\S]*?detaching a candidate may only clear its ballot position/i);
  assert.match(guard, /new\.position_id is not null[\s\S]*?resolve_student_organization_participation/i);
});

test("closed, archived, done, and at/end-boundary elections remain denied by the shared helper", () => {
  assert.match(electionAuthorityMigration, /lower\(election_status\)\s+in\s*\('closed',\s*'archived',\s*'done'\)[\s\S]*?return false/i);
  assert.match(electionAuthorityMigration, /now_manila\s*>=\s*election_row\.end_date[\s\S]*?return false/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(new_election_id\)/i);
});

test("direct-client bypasses fail closed for untrusted, foreign, and non-editable elections", () => {
  assert.match(migration, /for insert\s+to authenticated/i);
  assert.match(migration, /for update\s+to authenticated/i);
  assert.match(migration, /for delete\s+to authenticated/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete)\s+to anon/i);
  assert.match(electionAuthorityMigration, /caller_uid\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(electionAuthorityMigration, /a\.role\s*=\s*'electoral_board'[\s\S]*?a\.organization_id\s*=\s*e\.organization_id/i);
  assert.match(electionAuthorityMigration, /lower\(election_status\)\s+in\s*\('closed',\s*'archived',\s*'done'\)/i);
  assert.match(electionAuthorityMigration, /now_manila\s*>=\s*election_row\.end_date/i);
  assert.match(guard, /if old\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(guard, /if new\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(guard, /new\.campaign_status is distinct from old\.campaign_status/i);
  assert.match(guard, /old\.position_id is null and new\.position_id is null then[\s\S]*?raise exception/i);
  assert.match(guard, /old\.position_id is not null[\s\S]*?kandid_can_mutate_election_positions\(old_election_id\)[\s\S]*?old\.position_id is not null\s+and new\.position_id is null/i);
});

test("candidate writes reuse trusted active-term organization eligibility", () => {
  assert.match(guard, /where at\.status = 'active'[\s\S]*?order by at\.created_at desc, at\.id desc/i);
  assert.match(guard, /public\.resolve_student_organization_participation\([\s\S]*?new\.student_id[\s\S]*?new_organization_id[\s\S]*?active_academic_term_id/i);
  assert.match(guard, /participation_allowed is distinct from true/i);
  assert.match(guard, /security definer\s+set search_path = pg_catalog/i);
  assert.match(guard, /auth\.uid\(\) is null/i);
});

test("partylist affiliation is reusable across elections and only FK existence is required", () => {
  assert.match(migration, /partylist affiliation is reusable across elections/i);
  assert.doesNotMatch(guard, /partylist_election_id|from public\.partylists|partylist\.election_id/i);
  assert.doesNotMatch(migration, /kandid_guard_partylist_candidate_election|partylists_preserve_candidate_election/i);
  assert.doesNotMatch(migration, /alter table public\.candidates[\s\S]*?constraint|drop constraint/i);
  assert.match(migration, /partylist_id,/i);
});

test("partylist affiliation cannot bypass authority derived from the candidate position", () => {
  assert.match(guard, /select p\.election_id, e\.organization_id\s+into new_election_id, new_organization_id[\s\S]*?where p\.id = new\.position_id/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(migration, /where p\.id = candidates\.position_id\s+and public\.kandid_can_mutate_election_positions\(p\.election_id\)/i);
  assert.doesNotMatch(guard, /partylist\.election_id|partylist_election_id/i);
});

test("existing partylist foreign key remains the integrity check for nonexistent IDs", () => {
  // Production has candidates_partylist_id_fkey; this migration must leave it
  // untouched so PostgreSQL continues rejecting nonexistent partylist IDs.
  assert.doesNotMatch(migration, /drop constraint[^;]*candidates_partylist_id_fkey/i);
  assert.doesNotMatch(migration, /alter table public\.candidates[\s\S]*?drop constraint/i);
  assert.match(migration, /grant insert \([\s\S]*?partylist_id[\s\S]*?\) on public\.candidates to authenticated/i);
  assert.match(migration, /grant update \([\s\S]*?partylist_id[\s\S]*?\) on public\.candidates to authenticated/i);
});

test("existing Candidate UIs retain their actual write columns and detach workflow", () => {
  const writeColumns = [
    "position_id",
    "student_id",
    "partylist_id",
    "photo",
    "bio",
    "platform",
    "credentials",
    "campaign_materials",
    "campaign_media_urls",
  ];
  const grantBlock = migration.match(/grant insert \(([\s\S]*?)\) on public\.candidates to authenticated/i)?.[1] || "";
  const updateGrantBlock = migration.match(/grant update \(([\s\S]*?)\) on public\.candidates to authenticated/i)?.[1] || "";
  for (const column of writeColumns) {
    assert.match(grantBlock, new RegExp(`\\b${column}\\b`, "i"));
    assert.match(updateGrantBlock, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.doesNotMatch(grantBlock, /campaign_status|created_at|\bid\b/i);
  assert.doesNotMatch(updateGrantBlock, /campaign_status|created_at|\bid\b/i);
  assert.match(candidateManagement, /saveCandidateEdit\(supabase, editingCandidate, form, position\.election_id\)/i);
  assert.match(candidateManagement, /createCandidateSubmission\(supabase\)/i);
  assert.match(superAdminPositions, /disconnectCandidateSafely\(supabase, candidate,/i);
});

test("anonymous mutations are removed from candidates and the unused candidate_media writer", () => {
  assert.match(migration, /revoke all privileges on table public\.candidates\s+from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.candidates to anon, authenticated/i);
  assert.match(migration, /revoke all privileges on sequence public\.candidates_id_seq\s+from public, anon, authenticated/i);
  assert.match(migration, /grant usage on sequence public\.candidates_id_seq to authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.candidate_media\s+from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.candidate_media to anon, authenticated/i);
  assert.match(migration, /revoke all privileges on sequence public\.candidate_media_id_seq\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*candidate_media[^;]*to (?:anon|authenticated)/i);
  assert.match(migration, /drop policy if exists candidate_media_all_access[\s\S]*?drop policy if exists "open candidate_media"/i);
  assert.match(migration, /create policy candidate_media_public_read[\s\S]*?for select\s+to anon, authenticated\s+using \(true\)/i);
  assert.doesNotMatch(migration, /create policy candidate_media[^;]*for (?:insert|update|delete|all)/i);
});

test("candidate_media remains read-only to clients and its existing data protections are untouched", () => {
  assert.match(migration, /drop policy if exists candidate_media_all_access/i);
  assert.match(migration, /drop policy if exists "open candidate_media"/i);
  assert.match(migration, /create policy candidate_media_public_read[\s\S]*?for select\s+to anon, authenticated\s+using \(true\)/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*candidate_media|drop constraint[^;]*candidate_media|drop table[^;]*candidate_media/i);
});

test("duplicate protection, vote history, and campaign status rules remain unchanged", () => {
  assert.match(electionAuthorityMigration, /kandid_can_mutate_election_positions\(p_election_id\)/i);
  assert.match(migration, /kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*candidates_one_student_per_election_guard/i);
  assert.doesNotMatch(migration, /drop constraint[^;]*(?:votes_candidate_id_fkey|candidates_campaign_status_check)/i);
  assert.doesNotMatch(migration, /alter table public\.candidates[\s\S]*?campaign_status_check/i);
  assert.match(guard, /new\.campaign_status is distinct from old\.campaign_status/i);
});
