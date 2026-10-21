import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261021100000_candidate_eligibility_uses_election_term.sql",
  "utf8",
);
const activationMigration = readFileSync(
  "supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql",
  "utf8",
);
const termSelect = readFileSync("src/components/AcademicTermSelect.jsx", "utf8");
const voteHandler = readFileSync("supabase/functions/submit-vote/index.ts", "utf8");

const guardMatch = migration.match(
  /create or replace function public\.kandid_guard_candidate_mutation\([\s\S]*?\$function\$;/i,
);
assert.ok(guardMatch, "corrective migration must replace the candidate mutation guard");
const guard = guardMatch[0];

test("candidate mutation eligibility follows the selected election term", () => {
  assert.match(
    guard,
    /select p\.election_id, e\.organization_id, e\.academic_term_id[\s\S]*?into new_election_id, new_organization_id, new_election_term_id/i,
  );
  assert.match(guard, /eligibility_term_id := new_election_term_id/i);
  assert.match(
    guard,
    /resolve_student_organization_participation\([\s\S]*?new\.student_id[\s\S]*?new_organization_id[\s\S]*?eligibility_term_id/i,
  );
  assert.match(guard, /if participation_allowed is distinct from true then[\s\S]*?raise exception/i);
});

test("legacy termless elections retain a fail-closed active-term fallback", () => {
  assert.match(guard, /if eligibility_term_id is null then[\s\S]*?where at\.status = 'active'/i);
  assert.match(guard, /if eligibility_term_id is null then[\s\S]*?Active academic-term eligibility could not be verified/i);
  assert.match(guard, /new\.position_id is not null then[\s\S]*?eligibility_term_id := new_election_term_id/i);
});

test("correction preserves trusted election authorization and the existing trigger function contract", () => {
  assert.match(guard, /auth\.uid\(\) is null/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(new_election_id\)/i);
  assert.match(guard, /kandid_can_mutate_election_positions\(old_election_id\)/i);
  assert.match(guard, /security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(migration, /alter function public\.kandid_guard_candidate_mutation\(\) owner to postgres/i);
  assert.match(migration, /revoke all on function public\.kandid_guard_candidate_mutation\(\)[\s\S]*?from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /drop trigger|create trigger/i);
  assert.match(migration, /begin;[\s\S]*do \$preflight\$[\s\S]*do \$postflight\$[\s\S]*commit;/i);
});

test("term activation enrolls no one implicitly and only synchronizes target-term enrolled Students", () => {
  const activation = activationMigration.match(
    /create or replace function public\.sync_organization_term_participation_for_activation\(\s*p_target_term_id integer\s*\)[\s\S]*?\$function\$;/i,
  )?.[0];
  assert.ok(activation);
  assert.match(activation, /from public\.student_term_enrollments ste[\s\S]*?where ste\.academic_term_id = p_target_term_id[\s\S]*?and ste\.enrollment_status = 'enrolled'/i);
  assert.doesNotMatch(activation, /insert into public\.student_term_enrollments/i);
  assert.match(activation, /on conflict \(student_id, organization_id, academic_term_id\) do nothing/i);
  assert.match(activation, /prior\.status = 'active'/i);
  assert.match(activation, /prior\.academic_term_id = previous_term_id/i);
});

test("term-bound voting delegates to the JWT-derived canonical predicate and rechecks at atomic insertion", () => {
  // Enrollment enforcement moved into the database. Requiring duplicated Edge
  // queries here obscured the actual security contract. The isolated PG runner
  // exercises this predicate and real insertion against verified/unverified rows.
  const canonical = readFileSync("supabase/proposals/automatic-voter-eligibility.core.sql", "utf8");
  assert.match(voteHandler, /authClient\.rpc\(\s*"kandid_check_student_ballot_eligibility",\s*\{ p_election_id: electionId \}/);
  assert.match(canonical, /where auth_user_id=auth\.uid\(\)/);
  assert.match(canonical, /join public\.academic_terms t on t\.id=e\.academic_term_id and t\.status='active'/);
  assert.match(canonical, /ste\.academic_term_id=e\.academic_term_id and ste\.enrollment_status='enrolled'/);
  assert.match(canonical, /count\(\*\) from public\.academic_terms where status='active'\)=1/);
  assert.match(canonical, /kandid_require_locked_electorate_for_ballot\(\)[\s\S]*?kandid_student_is_live_eligible\(new\.election_id,new\.student_id\)/);
  assert.match(voteHandler, /adminClient\.rpc\(\s*"insert_v2_vote_rows"/);
});

test("the Board term selector makes the chosen term explicit rather than deriving it from active term", () => {
  assert.match(termSelect, /listAcademicTerms\(\)/);
  assert.match(termSelect, /terms\.map\(\(term\)/);
  assert.match(termSelect, /Choose the academic term this election belongs to; it is not inferred from the active term\./);
});
