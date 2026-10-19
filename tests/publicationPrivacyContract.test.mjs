import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isWithinGeofence, parseCoordinates } from "../supabase/functions/_shared/geofence.js";

const migration = readFileSync(
  "supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql",
  "utf8",
);
const monitor = readFileSync("src/pages/board/VotingMonitor.jsx", "utf8");
const votePage = readFileSync("src/pages/student/VotePage.jsx", "utf8");
const submitVote = readFileSync("supabase/functions/submit-vote/index.ts", "utf8");
const voteAccess = readFileSync("supabase/functions/vote-access/index.ts", "utf8");
const campaignMigration = readFileSync("supabase/migrations/20260920120000_student_campaign_trusted_rpc.sql", "utf8");
const boardReports = readFileSync("supabase/migrations/20261002100000_board_election_reports_read_rpcs.sql", "utf8");
const studentTurnout = readFileSync("supabase/migrations/20261002150000_freeze_election_electorates.sql", "utf8");
const resultLoader = readFileSync("src/utils/resultDataLoader.js", "utf8");
const studentResultsPage = readFileSync("src/pages/student/Results.jsx", "utf8");
const candidateManagement = readFileSync("src/components/CandidateManagement.jsx", "utf8");
const superAdminPositions = readFileSync("src/pages/superadmin/Positions.jsx", "utf8");
const globalSearch = readFileSync("src/utils/globalSearch.js", "utf8");
const deleteGuards = readFileSync("src/utils/deleteGuards.js", "utf8");
const kioskVoting = readFileSync("src/pages/shared/KioskVoting.jsx", "utf8");

test("nullable candidate rows require an active Super Admin before update", () => {
  const updatePolicy = migration.match(/create policy candidates_update_authorized_election[\s\S]*?;\s*\n\s*create or replace function/i)?.[0] || "";
  assert.match(updatePolicy, /position_id is not null[\s\S]*kandid_can_mutate_election_positions/i);
  assert.match(updatePolicy, /position_id is null[\s\S]*kandid_active_admin_can_access_organization\(null\)/i);
  assert.doesNotMatch(updatePolicy, /position_id is null\s+or/i);
});

test("publication reads exclude drafts and unreleased archives and scope Students by trusted participation", () => {
  assert.match(migration, /status <> 'draft' and \(status <> 'archived' or results_released_at is not null\)/i);
  assert.match(migration, /private\.kandid_student_can_read_election\(id\)/i);
  assert.match(migration, /campaign_status='published'/i);
  assert.match(migration, /grant select \(id, organization_id, academic_term_id, title, cover_url/i);
  assert.match(migration, /grant select \(id, organization_id, academic_term_id, title, cover_url,[\s\S]*?electorate_policy_version,\s*electorate_frozen_at\)\s+on public\.elections to authenticated/i);
  assert.doesNotMatch(migration, /grant select[\s\S]{0,240}geo_lat/i);
  assert.match(migration, /has_column_privilege\('authenticated','public\.elections','electorate_frozen_by','SELECT'\)/i);
  assert.match(migration, /kandid_get_admin_election_geofence/i);
  assert.match(migration, /resolve_student_organization_participation/i);
  assert.match(migration, /create or replace function private\.kandid_active_admin_can_access_organization\(\s*p_organization_id bigint\s*\)[\s\S]*?where a\.auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /create or replace function private\.kandid_student_can_read_election\(\s*p_election_id integer\s*\)[\s\S]*?where s\.auth_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /kandid_(?:active_admin_can_access_organization|student_can_read_election)\(auth\.uid\(\),/i);
  const studentPolicy = migration.match(/create policy students_release_safe_select[\s\S]*?\n\);/i)?.[0] || "";
  assert.match(studentPolicy, /private\.kandid_board_can_read_candidate_student\(students\.id\)/i);
  assert.doesNotMatch(studentPolicy, /candidates\s+c\s+on\s+c\.student_id/i);
  const boardCandidateStudentHelper = migration.match(
    /create or replace function private\.kandid_board_can_read_candidate_student\([\s\S]*?\$function\$;/i,
  )?.[0] || "";
  assert.match(boardCandidateStudentHelper, /security definer[\s\S]*?set search_path = pg_catalog/i);
  assert.match(boardCandidateStudentHelper, /a\.role='electoral_board'[\s\S]*?a\.status='active'[\s\S]*?a\.organization_id=e\.organization_id/i);
  assert.match(boardCandidateStudentHelper, /c\.student_id=p_student_id[\s\S]*?join public\.positions p[\s\S]*?join public\.elections e/i);
});

test("Student campaign uses a separate authenticated published-only RPC", () => {
  const publishedCampaign = migration.match(/create or replace function public\.kandid_get_student_published_campaign[\s\S]*?\$function\$;/i)?.[0] || "";
  assert.match(migration, /revoke all on function public\.get_student_campaign\(integer\) from public,anon,authenticated,service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_get_student_published_campaign\(integer\) to authenticated/i);
  assert.match(publishedCampaign, /auth\.uid\(\)/i);
  assert.match(publishedCampaign, /student_status is distinct from 'active'/i);
  assert.match(publishedCampaign, /resolve_student_organization_participation/i);
  assert.match(publishedCampaign, /e\.academic_term_id/i);
  assert.match(publishedCampaign, /term_id_value := election_row\.academic_term_id/i);
  assert.match(publishedCampaign, /c\.campaign_status='published'/i);
  assert.match(publishedCampaign, /campaign_start/);
  assert.match(publishedCampaign, /campaign_end/);
  assert.match(campaignMigration, /get_student_campaign/i);
  assert.match(readFileSync("src/pages/student/Campaign.jsx", "utf8"), /rpc\("kandid_get_student_published_campaign"/i);
});

test("results use separate scoped Board, eligible Student, and explicitly released public paths", () => {
  assert.match(boardReports, /kandid_get_board_election_report_package[\s\S]*?Active Electoral Board organization authorization required/i);
  assert.match(boardReports, /e\.organization_id = organization_id_value/i);
  assert.match(studentTurnout, /election_row\.results_released_at is not null/i);
  assert.match(studentTurnout, /student_result_visibility = 'realtime'/i);
  assert.match(studentTurnout, /student_result_visibility in \('hidden', 'after_close'\)/i);
  assert.match(migration, /kandid_get_public_released_election_results[\s\S]*?results_released_at is not null/i);
  assert.match(migration, /'abstentions'/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.kandid_get_public_released_election_results[\s\S]*?\$function\$;/i)?.[0] || "", /'(?:student_id|student_number|auth_user_id|vote_hash|ballot_hash)'/i);
  assert.match(voteAccess, /if \(role === "student"\)[\s\S]*?kandid_get_election_turnout/i);
  assert.match(resultLoader, /callVoteAccess\("election_results"/i);
  assert.doesNotMatch(resultLoader, /student_number/);
  assert.doesNotMatch(studentResultsPage, /getStudentElectionOrganizationIds|\.in\("organization_id"/);
  assert.match(studentResultsPage, /\.neq\("status", "draft"\)/);
});

test("unprovenanced V1 public campaign snapshots are deferred", () => {
  assert.doesNotMatch(migration, /kandid_get_public_campaign_snapshot/i);
  assert.doesNotMatch(migration, /grant execute[^;]*campaign_snapshot/i);
});

test("candidate Student linkage is withheld from direct authenticated column access", () => {
  assert.match(migration, /revoke select on table public\.candidates from public, anon, authenticated/i);
  assert.match(migration, /grant select \(id, position_id, partylist_id, photo, bio, platform, credentials,[\s\S]*?on public\.candidates to authenticated/i);
  assert.doesNotMatch(migration.match(/grant select \([^)]*\)\s+on public\.candidates to authenticated/i)?.[0] || "", /student_id/i);
  assert.match(migration, /has_column_privilege\('authenticated','public\.candidates','student_id','SELECT'\)/i);
  const adminDirectory = migration.match(/create or replace function public\.kandid_admin_candidate_directory[\s\S]*?\$function\$;/i)?.[0] || "";
  assert.match(adminDirectory, /auth\.uid\(\)/i);
  assert.match(adminDirectory, /status='active'/i);
  assert.match(adminDirectory, /role in \('super_admin','electoral_board'\)/i);
  assert.match(adminDirectory, /kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
  assert.match(adminDirectory, /security definer[\s\S]*?set search_path=pg_catalog/i);
  assert.match(migration, /kandid_get_student_ballot_candidates[\s\S]*?security definer[\s\S]*?set search_path=pg_catalog/i);
  assert.match(migration, /kandid_get_student_result_candidates[\s\S]*?kandid_get_election_turnout\(p_election_id\)/i);
  const studentResultCandidates = migration.match(
    /create or replace function public\.kandid_get_student_result_candidates\([\s\S]*?\$function\$;/i,
  )?.[0] || "";
  const resultVisibilityGate = studentResultCandidates.indexOf("perform public.kandid_get_election_turnout(p_election_id)");
  const candidateResultRead = studentResultCandidates.indexOf("from public.candidates c");
  assert.ok(resultVisibilityGate >= 0 && candidateResultRead > resultVisibilityGate,
    "Student candidate results must pass the existing election visibility and participation RPC before candidate reads");
  assert.match(studentTurnout, /if not visible_to_student or not student_participation_allowed then[\s\S]*?raise exception using errcode = '42501'/i);
  assert.match(migration, /grant execute on function public\.kandid_admin_candidate_directory\(integer\[\],integer\[\]\) to authenticated/i);
});

test("candidate management reads use the admin RPC while ballot clients use the eligible Student RPC", () => {
  assert.match(candidateManagement, /loadAdminCandidates\(\{ electionIds: \[normalizedElectionId\] \}\)/);
  assert.match(superAdminPositions, /loadAdminCandidates\(\{ electionIds: \[position\.election_id\] \}\)/);
  assert.match(migration, /create or replace function public\.kandid_admin_candidate_directory\([\s\S]*?a\.auth_user_id=caller_uid and a\.status='active'[\s\S]*?private\.kandid_active_admin_can_access_organization\(e\.organization_id\)/i);
  assert.match(globalSearch, /loadAdminCandidates\(\{ studentIds \}\)/);
  assert.match(globalSearch, /kandid_get_student_published_campaign/);
  assert.match(resultLoader, /kandid_get_student_result_candidates/);
  assert.match(resultLoader, /loadAdminCandidates\(\{ electionIds \}\)/);
  assert.match(deleteGuards, /loadAdminCandidates\(\{\s*studentIds: \[id\]/);
  assert.match(kioskVoting, /kandid_get_student_ballot_candidates/);
  assert.match(votePage, /kandid_get_student_ballot_candidates/);
  assert.doesNotMatch(candidateManagement.match(/async function refreshCandidates[\s\S]*?async function fetchStudentsByPosition/i)?.[0] || "", /\.from\("candidates"\)[\s\S]*?student_id/);
  assert.doesNotMatch(superAdminPositions.match(/async function fetchCandidates[\s\S]*?async function openCandidates/i)?.[0] || "", /\.from\("candidates"\)[\s\S]*?student_id/);
});

test("candidate eligibility correction precedes the dependent publication/privacy contract", () => {
  const eligibilityPath = "supabase/migrations/20261021100000_candidate_eligibility_uses_election_term.sql";
  const publicationPath = "supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql";
  const eligibility = readFileSync(eligibilityPath, "utf8");
  assert.ok(eligibilityPath.localeCompare(publicationPath) < 0);
  assert.match(eligibility, /create or replace function public\.kandid_guard_candidate_mutation/i);
  assert.match(eligibility, /candidates_trusted_mutation_guard/i);
  assert.match(migration, /public\.kandid_can_mutate_election_positions\(integer\)/i);
  assert.match(migration, /candidates_update_authorized_election/i);
});

test("Board monitor client no longer renders ballot identities or per-ballot activity", () => {
  assert.match(migration, /'ballots','\[\]'::jsonb/i);
  assert.doesNotMatch(monitor, /student_number|first_name|last_name|submitted_at|blockchain_anchor_status|Load older ballots/i);
  assert.match(monitor, /Aggregate ballot status/i);
});

test("geofence input rejects malformed/out-of-range coordinates and accepts the configured location", () => {
  assert.equal(parseCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(parseCoordinates({ latitude: 0, longitude: "0" }), null);
  assert.deepEqual(parseCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
  const center = { latitude: 14.5995, longitude: 120.9842 };
  assert.equal(isWithinGeofence(center, 14.5995, 120.9842, 100), true);
  assert.equal(isWithinGeofence({ latitude: 14.61, longitude: 120.9842 }, 14.5995, 120.9842, 100), false);
  assert.equal(isWithinGeofence(center, 91, 120, 100), false);
  assert.match(voteAccess, /student_verify_geofence/);
  assert.match(submitVote, /votingAccessMode === "location_range"[\s\S]*parseCoordinates\(body\.location\)/);
  assert.match(submitVote, /isWithinGeofence\(/);
  assert.doesNotMatch(votePage, /geo_lat|geo_lng|geo_radius_meters/);
  assert.match(votePage, /student_verify_geofence/);
});
