import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotAnchorPresentation } from "../src/utils/ballotMonitor.js";

const migration = readFileSync(
  "supabase/migrations/20261021110000_publication_and_board_privacy_contract.sql",
  "utf8",
);
const component = readFileSync("src/pages/board/VotingMonitor.jsx", "utf8");

const rpcStart = migration.indexOf("create or replace function public.kandid_get_board_voting_monitor");
const rpcEnd = migration.indexOf("$function$;", rpcStart);
assert.notEqual(rpcStart, -1, "Expected forward Board monitor RPC definition");
assert.notEqual(rpcEnd, -1, "Expected Board monitor RPC body");
const rpc = migration.slice(rpcStart, rpcEnd);

test("Board monitor derives and enforces the caller's single active organization", () => {
  assert.match(rpc, /caller_uid uuid := auth\.uid\(\)/i);
  assert.match(rpc, /a\.role='electoral_board'/i);
  assert.match(rpc, /a\.status='active'/i);
  assert.match(rpc, /e\.organization_id=organization_id_value/i);
  assert.doesNotMatch(rpc, /p_organization_id/i);
  assert.match(migration, /revoke all on function public\.kandid_get_board_voting_monitor\(integer,integer,integer\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_get_board_voting_monitor\(integer,integer,integer\) to authenticated/i);
});

test("Monitor returns aggregate counts and no named or per-ballot information", () => {
  assert.match(rpc, /from public\.vote_ballots b/i);
  for (const field of ["ballots_submitted", "students_voted", "anchored", "processing", "needs_attention"]) {
    assert.match(rpc, new RegExp(`'${field}'`, "i"));
  }
  assert.match(rpc, /'ballots','\[\]'::jsonb/i);
  assert.doesNotMatch(rpc, /'student_number'|'first_name'|'last_name'|'submitted_at'|'ballot_id'/i);
  assert.match(rpc, /count\(distinct student_id\)/i);
  assert.doesNotMatch(rpc, /from public\.votes\b/i);
});

test("Frontend displays only aggregate monitor results", () => {
  assert.match(component, /rpc\("kandid_get_board_voting_monitor"/i);
  assert.match(component, /p_election_id: electionId/i);
  assert.doesNotMatch(component, /student_number|first_name|last_name|submitted_at|blockchain_anchor_status|Load older ballots/i);
  assert.match(component, /Aggregate ballot status/i);
  assert.doesNotMatch(component, /\.from\("votes"\)/i);
});

test("stored anchor states retain their truthful summary labels", () => {
  assert.deepEqual(ballotAnchorPresentation("pending"), { label: "Pending", tone: "processing" });
  assert.deepEqual(ballotAnchorPresentation("anchoring"), { label: "Anchoring", tone: "processing" });
  assert.deepEqual(ballotAnchorPresentation("submitted"), { label: "Submitted", tone: "processing" });
  assert.deepEqual(ballotAnchorPresentation("anchored"), { label: "Anchored", tone: "anchored" });
  assert.deepEqual(ballotAnchorPresentation("anchor_failed"), { label: "Anchor failed", tone: "attention" });
  assert.deepEqual(ballotAnchorPresentation("manual_review"), { label: "Needs review", tone: "attention" });
});
