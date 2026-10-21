import assert from "node:assert/strict";
import test from "node:test";
import {
  assertElectorateSchedulingReady, electorateLockBlock, electorateReadinessLabel,
  ELECTORATE_RULE_CONTRACT,
} from "../src/utils/electorateFinalization.js";

const base = { election_id: 9, eligibility_contract: ELECTORATE_RULE_CONTRACT,
  rule_count: 0, eligible_voters: 2, is_locked: false, locking_allowed: false };

test("zero rules are valid and scheduled finalization has distinct Board states", () => {
  assert.equal(electorateLockBlock({ ...base, locking_allowed: true }, 9), "");
  assert.equal(electorateReadinessLabel({ ...base, finalization_state: "scheduled" }), "Finalization scheduled");
  assert.equal(electorateReadinessLabel({ ...base, finalization_state: "retrying" }), "Finalization failed — retry scheduled");
  assert.equal(electorateReadinessLabel({ ...base, finalization_state: "missed" }), "Voting blocked — finalization cutoff missed");
  assert.equal(electorateReadinessLabel({ ...base, is_locked: true }), "Electorate finalized");
});

test("empty population, unavailable capability and not-due state cannot be manually frozen", () => {
  assert.match(electorateLockBlock({ ...base, eligible_voters: 0, locking_allowed: true }, 9), /nonempty/);
  assert.match(electorateLockBlock({ ...base, eligibility_contract: null }, 9), /backend is activated/);
  assert.match(electorateLockBlock(base, 9), /not ready/);
});

test("active election scheduling requires trusted same-organization readiness before save", async () => {
  let args;
  const client = { rpc(name, body) { args = [name, body]; return { retry: async () => ({ data: {
    eligibility_contract: ELECTORATE_RULE_CONTRACT, scheduler_ready: true, organization_id: 2,
  }, error: null }) }; } };
  await assertElectorateSchedulingReady(client, null, { status: "active", organization_id: 2,
    academic_term_id: 4, start_date: "2026-10-21T20:00:00", end_date: "2026-10-21T22:00:00" });
  assert.deepEqual(args, ["kandid_get_board_electorate_scheduler_readiness", {}]);
});

test("unhealthy scheduler blocks active activation and schedule changes", async () => {
  const client = { rpc() { return { retry: async () => ({ data: {
    eligibility_contract: ELECTORATE_RULE_CONTRACT, scheduler_ready: false, organization_id: 2,
  }, error: null }) }; } };
  await assert.rejects(assertElectorateSchedulingReady(client, null, { status: "active", organization_id: 2 }),
    { code: "ELECTORATE_SCHEDULER_UNAVAILABLE" });
});

test("unchanged active election metadata edits do not require an extra scheduler read", async () => {
  const client = { rpc() { throw new Error("unexpected scheduler check"); } };
  const original = { status: "active", organization_id: 2, academic_term_id: 4,
    start_date: "2026-10-21T20:00:00", end_date: "2026-10-21T22:00:00" };
  await assertElectorateSchedulingReady(client, original, original);
});
