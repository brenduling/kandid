import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261002100000_board_election_reports_read_rpcs.sql",
  "utf8",
);

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `Expected ${name} definition`);
  const end = migration.indexOf("$function$;", start);
  assert.notEqual(end, -1, `Expected ${name} body terminator`);
  return migration.slice(start, end);
}

const listRpc = functionBody("kandid_list_board_report_elections");
const packageRpc = functionBody("kandid_get_board_election_report_package");
const votingSummaryStart = packageRpc.indexOf("select jsonb_build_object(\n    'election'");
const votingSummaryEnd = packageRpc.indexOf("into voting_summary;", votingSummaryStart);
assert.notEqual(votingSummaryStart, -1, "Expected Voting Summary JSON body");
assert.notEqual(votingSummaryEnd, -1, "Expected Voting Summary assignment");
const votingSummary = packageRpc.slice(votingSummaryStart, votingSummaryEnd);

test("the migration exposes separate election-list and selected-election report RPCs", () => {
  assert.match(migration, /kandid_list_board_report_elections\(\)/i);
  assert.match(migration, /kandid_get_board_election_report_package\(\s*p_election_id integer\s*\)/i);
  assert.doesNotMatch(listRpc.slice(0, listRpc.indexOf("returns jsonb")), /p_election_id|p_organization_id/i);
  assert.doesNotMatch(packageRpc.slice(0, packageRpc.indexOf("returns jsonb")), /p_organization_id/i);
  assert.match(migration, /revoke all on function public\.kandid_list_board_report_elections\(\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_list_board_report_elections\(\)\s+to authenticated/i);
  assert.match(migration, /revoke all on function public\.kandid_get_board_election_report_package\(integer\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_get_board_election_report_package\(integer\)\s+to authenticated/i);
});

test("both RPCs derive one active Electoral Board organization from auth.uid()", () => {
  for (const rpc of [listRpc, packageRpc]) {
    assert.match(rpc, /security definer/i);
    assert.match(rpc, /set search_path = pg_catalog/i);
    assert.match(rpc, /caller_uid uuid := auth\.uid\(\)/i);
    assert.match(rpc, /a\.role = 'electoral_board'/i);
    assert.match(rpc, /a\.status = 'active'/i);
    assert.match(rpc, /a\.organization_id is not null/i);
    assert.match(rpc, /assignment_count <> 1/i);
    assert.doesNotMatch(rpc, /p_organization_id/i);
  }
  assert.match(listRpc, /where e\.organization_id = organization_id_value/i);
  assert.match(packageRpc, /e\.organization_id = organization_id_value/i);
});

test("election register returns only compact scoped election context", () => {
  assert.match(listRpc, /'elections', elections_result/i);
  for (const field of ["id", "title", "status", "campaign_start", "campaign_end", "start_date", "end_date", "created_at"]) {
    assert.match(listRpc, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(listRpc, /candidate_report|position_report|voting_summary|from public\.votes\b/i);
});

test("foreign and invalid election IDs fail with the same non-disclosing error", () => {
  assert.match(packageRpc, /p_election_id is not null/i);
  assert.match(packageRpc, /p_election_id > 0/i);
  assert.match(packageRpc, /e\.id = p_election_id/i);
  assert.match(packageRpc, /e\.organization_id = organization_id_value/i);
  assert.match(packageRpc, /if not found then\s+raise exception using errcode = '42501', message = 'Election is unavailable\.'/i);
  assert.doesNotMatch(packageRpc, /Election not found|outside your organization/i);
});

test("selected election package separates the four election-scoped datasets", () => {
  for (const dataset of ["election_report", "position_report", "candidate_report", "voting_summary"]) {
    assert.match(packageRpc, new RegExp(`'${dataset}'`));
  }
  assert.match(packageRpc, /election_row\.id/);
  assert.match(packageRpc, /where p\.election_id = election_row\.id/i);
  assert.match(packageRpc, /p\.election_id = election_row\.id/i);
  assert.match(packageRpc, /p\.id = c\.position_id\s+and p\.election_id = election_row\.id/i);
});

test("Candidate Report has deliberate flattened scalar fields", () => {
  for (const field of [
    "candidate_id", "position_name", "student_id", "candidate_name", "student_number",
    "partylist_id", "partylist_name", "platform", "photo", "campaign_status", "created_at",
  ]) {
    assert.match(packageRpc, new RegExp(`'${field}'`));
  }
  assert.match(packageRpc, /left join public\.students s\s+on s\.id = c\.student_id/i);
  assert.match(packageRpc, /'partylist_id', pl\.id/i);
  assert.match(packageRpc, /left join public\.partylists pl\s+on pl\.id = c\.partylist_id\s+and pl\.organization_id = election_row\.organization_id/i);
});

test("Candidate Report returns partylist identity only for the selected election organization", () => {
  const candidateReportStart = packageRpc.indexOf("select coalesce(\n    jsonb_agg(", packageRpc.indexOf("into position_report;"));
  const candidateReportEnd = packageRpc.indexOf("select count(*)\n    into ballot_record_count", candidateReportStart);
  assert.notEqual(candidateReportStart, -1, "Expected Candidate Report query");
  assert.notEqual(candidateReportEnd, -1, "Expected Candidate Report assignment");
  const candidateReport = packageRpc.slice(candidateReportStart, candidateReportEnd);

  assert.match(candidateReport, /'partylist_id', pl\.id/i);
  assert.match(candidateReport, /'partylist_name', pl\.name/i);
  assert.match(candidateReport, /left join public\.partylists pl\s+on pl\.id = c\.partylist_id\s+and pl\.organization_id = election_row\.organization_id/i);
  assert.doesNotMatch(candidateReport, /'partylist_id', c\.partylist_id/i);
});

test("Voting Summary counts canonical candidate votes and position abstentions only as aggregates", () => {
  assert.match(votingSummary, /'candidate_id', c\.id/i);
  assert.match(votingSummary, /'candidate_name'/i);
  assert.match(votingSummary, /'vote_total', coalesce\(t\.vote_total, 0\)/i);
  assert.match(votingSummary, /v\.is_abstain is false/i);
  assert.match(votingSummary, /v\.candidate_id = c\.id/i);
  assert.match(votingSummary, /'abstention_total'/i);
  assert.match(votingSummary, /v\.is_abstain is true/i);
  assert.doesNotMatch(votingSummary, /v\.student_id|ballot_id|vote_hash|ballot_hash|blockchain_tx_id|nonce|receipt/i);
});

test("Voting Summary uses vote_ballots counts and explicitly distinguishes legacy and mixed records", () => {
  assert.match(packageRpc, /from public\.vote_ballots b\s+where b\.election_id = election_row\.id/i);
  assert.match(packageRpc, /v\.ballot_id is null/i);
  assert.match(packageRpc, /'ballot_count_source', 'vote_ballots'/i);
  assert.match(packageRpc, /'ballot_count_availability', ballot_count_availability/i);
  assert.match(packageRpc, /'authoritative_ballot_count', authoritative_ballot_count/i);
  assert.match(packageRpc, /'legacy_vote_rows_without_ballot', legacy_vote_row_count/i);
  assert.match(packageRpc, /'mixed_ballot_and_legacy'/i);
  assert.match(packageRpc, /'legacy_unavailable'/i);
  assert.match(packageRpc, /authoritative_ballot_count := null/i);
});

test("Voting Summary exposes no voter identity or individual vote or ballot secrets", () => {
  for (const forbidden of [
    "student_id", "student_number", "first_name", "last_name", "ballot_id", "ballot_hash",
    "vote_hash", "blockchain_tx_id", "blockchain_block_number", "nonce", "receipt",
  ]) {
    assert.doesNotMatch(votingSummary, new RegExp(`'${forbidden}'|v\\.${forbidden}`, "i"));
  }
  assert.doesNotMatch(votingSummary, /jsonb_agg\s*\(\s*to_jsonb|jsonb_build_object\([^)]*v\./i);
});
