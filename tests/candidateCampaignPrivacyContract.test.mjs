import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const migration = readFileSync("supabase/migrations/20261018161039_candidate_campaign_privacy_contract.sql", "utf8");
const storageMigration = readFileSync("supabase/migrations/20261018150914_campaign_material_storage.sql", "utf8");
const campaignPage = readFileSync("src/pages/student/Campaign.jsx", "utf8");
const votePage = readFileSync("src/pages/student/VotePage.jsx", "utf8");
const ballotReader = readFileSync("src/utils/studentBallotReadiness.js", "utf8");
const kiosk = readFileSync("src/pages/shared/KioskVoting.jsx", "utf8");
const resultLoader = readFileSync("src/utils/resultDataLoader.js", "utf8");

function functionBlock(name) {
  const start = migration.toLowerCase().indexOf("create function " + name.toLowerCase() + "(");
  const end = start < 0 ? -1 : migration.indexOf("$function$;", start);
  return start < 0 || end < 0 ? "" : migration.slice(start, end + "$function$;".length);
}

test("direct candidate table reads are removed for anon/students; admin id and position reads remain", () => {
  assert.match(migration, /drop policy candidates_public_read on public\.candidates/i);
  assert.match(migration, /create policy candidates_authenticated_admin_read[\s\S]*?to authenticated[\s\S]*?kandid_can_admin_read_candidate_v1\(id\)/i);
  assert.match(migration, /revoke select on table public\.candidates from public, anon, authenticated/i);
  assert.match(migration, /grant select \(id, position_id\) on public\.candidates to authenticated/i);
  assert.doesNotMatch(migration, /grant select on table public\.candidates to anon/i);
});

test("admin row helper derives role and organization from the authenticated admin record", () => {
  const helper = functionBlock("public.kandid_can_admin_read_candidate_v1");
  assert.match(helper, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(helper, /a\.auth_user_id = caller_uid[\s\S]*?a\.status = 'active'/i);
  assert.match(helper, /admin_count <> 1/i);
  assert.match(helper, /admin_role = 'super_admin'/i);
  assert.match(helper, /e\.organization_id = admin_organization_id/i);
  assert.doesNotMatch(helper, /p_organization_id|client.*organization/i);
  assert.match(helper, /security definer[\s\S]*?set search_path = pg_catalog/i);
});

test("student campaign contract returns only published candidates in the active campaign and term", () => {
  const campaign = functionBlock("public.kandid_get_student_published_campaign");
  assert.ok(campaign);
  assert.match(campaign, /caller_uid is null/i);
  assert.match(campaign, /student_count <> 1/i);
  assert.match(campaign, /student_status is distinct from 'active'/i);
  assert.match(campaign, /e\.status = 'active'[\s\S]*?e\.removed_at is null/i);
  assert.match(campaign, /active_term_count <> 1[\s\S]*?election_row\.academic_term_id is distinct from term_id_value/i);
  assert.match(campaign, /resolve_student_organization_participation/i);
  assert.match(campaign, /manila_now < election_row\.campaign_start/i);
  assert.match(campaign, /manila_now >= election_row\.campaign_end/i);
  assert.match(campaign, /where c\.campaign_status = 'published'/i);
  assert.match(campaign, /normalize_student_campaign_materials/i);
  assert.doesNotMatch(campaign, /'student_id'\s*,/i);
  assert.match(campaign, /status','UNAVAILABLE'[\s\S]*?'data',null/i);
});

test("legacy campaign RPC is a safe compatibility wrapper with authenticated-only execute", () => {
  const wrapper = migration.match(/create or replace function public\.get_student_campaign\(p_election_id integer\)[\s\S]*?\$function\$;/i)?.[0] || "";
  assert.match(wrapper, /select public\.kandid_get_student_published_campaign\(p_election_id\)/i);
  assert.match(migration, /revoke all on function public\.get_student_campaign\(integer\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.get_student_campaign\(integer\) to authenticated/i);
});

test("ballot RPC keeps registered candidate identity independent of campaign publication", () => {
  const ballot = functionBlock("public.kandid_get_student_ballot_candidates");
  assert.ok(ballot);
  assert.match(ballot, /e\.status='active' and e\.removed_at is null/i);
  assert.match(ballot, /manila_now < election_row\.start_date or manila_now >= election_row\.end_date/i);
  assert.match(ballot, /private\.election_eligible_voters/i);
  assert.match(ballot, /student_term_enrollments/i);
  assert.match(ballot, /resolve_student_organization_participation/i);
  assert.doesNotMatch(ballot, /campaign_status/i);
  assert.doesNotMatch(ballot, /campaign_materials|campaign_media_urls|'bio'|'platform'|'credentials'/i);
});

test("results remain behind the existing turnout gate and return no campaign content", () => {
  const results = functionBlock("public.kandid_get_student_result_candidates");
  assert.ok(results);
  assert.match(results, /perform public\.kandid_get_election_turnout\(p_election_id\)[\s\S]*?from public\.candidates/i);
  assert.doesNotMatch(results, /campaign_status|campaign_materials|campaign_media_urls|'bio'|'platform'|'credentials'|'student_id'/i);
  assert.match(resultLoader, /kandid_get_student_result_candidates/);
});

test("all current student campaign/ballot callers use the privacy RPCs", () => {
  assert.match(campaignPage, /rpc\("kandid_get_student_published_campaign"/);
  assert.match(votePage, /loadStudentBallotCandidates\(supabase, electionData\)/);
  assert.match(ballotReader, /rpc\("kandid_get_student_ballot_candidates"/);
  assert.doesNotMatch(ballotReader, /from\("candidates"\)/);
  assert.match(kiosk, /kandid_get_student_ballot_candidates/);
});

test("the frozen Storage migration retains its canonical Git content and delegates student reads through the legacy wrapper", () => {
  // Git's Windows checkout converts LF to CRLF. Keep the original reviewed
  // content hash, normalize only checkout newlines, and never edit the migration.
  const sha = createHash("sha256").update(storageMigration.replace(/\r\n/g, "\n")).digest("hex").toUpperCase();
  assert.equal(sha, "F179AC907C98C17D0FAF10B003C0627EB06F7ABA423134CDA8EB760890744D87");
  assert.match(storageMigration, /campaign_response := public\.get_student_campaign\(election_id_value\)/i);
  assert.match(storageMigration, /candidate\.value -> 'campaign_materials'/i);
  assert.match(storageMigration, /grant execute on function public\.kandid_campaign_storage_access_v1\(text, text\) to authenticated/i);
  assert.match(storageMigration, /create policy campaign_materials_scoped_read[\s\S]*?to authenticated/i);
});
