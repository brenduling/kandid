import assert from "node:assert/strict";
import test from "node:test";
import { LegacyAnchorEvidenceError, verifyLegacyVoteAnchorEvidence } from "../supabase/functions/_shared/legacyVoteAnchorEvidence.mjs";

const contract = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const voteHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const blockHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function validEvidence(overrides = {}) {
  return {
    requestedTransactionHash: txHash,
    expectedVoteHash: voteHash,
    expectedChainId: 11155111n,
    observedChainId: 11155111n,
    configuredContractAddress: contract,
    receipt: {
      hash: txHash,
      to: contract,
      status: 1,
      blockNumber: 88,
      blockHash,
      logs: [{ address: contract, topic: "registry-event" }],
    },
    parseRegistryEvent: () => ({ name: "VoteHashRecorded", args: { voteHash } }),
    isVoteHashRecorded: async () => true,
    getBlock: async () => ({ number: 88, hash: blockHash, timestamp: 1_800_000_000 }),
    ...overrides,
  };
}

async function rejectsCode(input, code) {
  await assert.rejects(
    verifyLegacyVoteAnchorEvidence(input),
    (error) => error instanceof LegacyAnchorEvidenceError && error.code === code,
  );
}

test("valid mocked Sepolia receipt returns only receipt, configured contract, and canonical block evidence", async () => {
  const evidence = await verifyLegacyVoteAnchorEvidence(validEvidence());
  assert.deepEqual(evidence, {
    transaction_hash: txHash,
    contract_address: contract,
    block_number: 88,
    anchored_at: new Date(1_800_000_000_000).toISOString(),
  });
});

test("wrong chain, failed receipt, wrong target, or mismatched transaction hash is rejected", async () => {
  await rejectsCode(validEvidence({ observedChainId: 1n }), "CHAIN_MISMATCH");
  await rejectsCode(validEvidence({ receipt: { ...validEvidence().receipt, status: 0 } }), "INVALID_RECEIPT");
  await rejectsCode(validEvidence({ receipt: { ...validEvidence().receipt, to: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" } }), "INVALID_RECEIPT");
  await rejectsCode(validEvidence({ receipt: { ...validEvidence().receipt, hash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" } }), "INVALID_RECEIPT");
});

test("receipt must contain the expected event from the configured registry", async () => {
  await rejectsCode(validEvidence({ parseRegistryEvent: () => ({ name: "VoteHashRecorded", args: { voteHash: txHash } }) }), "EVENT_MISMATCH");
  await rejectsCode(validEvidence({ receipt: { ...validEvidence().receipt, logs: [{ address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }] } }), "EVENT_MISMATCH");
});

test("registry state and canonical receipt block must both agree", async () => {
  await rejectsCode(validEvidence({ isVoteHashRecorded: async () => false }), "REGISTRY_MISMATCH");
  await rejectsCode(validEvidence({ getBlock: async () => ({ number: 88, hash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", timestamp: 1_800_000_000 }) }), "BLOCK_MISMATCH");
  await rejectsCode(validEvidence({ getBlock: async () => { throw new Error("mock RPC outage"); } }), "RPC_UNAVAILABLE");
});
