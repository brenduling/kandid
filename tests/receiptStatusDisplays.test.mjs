import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import {
  canRecordVoteHashOnChain,
  getBlockchainVerificationCounts,
  getBlockchainVerificationStatus,
} from "../src/utils/blockchainVerification.js";

const require = createRequire(import.meta.url);
function loadView(path, extraExports = "") {
  const module = { exports: {} };
  const source = readFileSync(path, "utf8");
  const code = transformSync(source, { loader: path.endsWith("jsx") ? "jsx" : "js", jsx: "automatic", format: "cjs", target: "es2022" }).code;
  new Function("require", "module", "exports", code + extraExports)(name => {
    if (!name.startsWith(".")) return require(name);
    if (name.includes("supabaseClient")) return { supabase: {} };
    if (name.includes("receiptData")) return receipt;
    if (name.includes("voteAccess")) return { callVoteAccess() { throw Error("No network allowed"); } };
    if (name.includes("positionOrder")) return { sortVotesByPositionOrder: rows => rows };
    if (name.includes("time")) return { formatAbsoluteTimestampAsManilaDateTime: () => "synthetic anchor time", parseUtcTimestamp: value => new Date(value) };
    return {}; // Other page imports are not invoked by these pure render checks.
  }, module, module.exports);
  return module.exports;
}
const receipt = loadView("src/pages/student/receiptData.js");
const list = loadView("src/pages/student/Receipt.jsx", "\nmodule.exports.BallotProgress = BallotProgress;");
const verification = loadView("src/pages/student/BallotVerification.jsx", "\nmodule.exports.getFinalState = getFinalState; module.exports.getProofRecord = getProofRecord;");
const transaction = "0x" + "b".repeat(64);
const record = (state, tx = null) => ({
  id: "synthetic-ballot", hash_version: "KANDID_BALLOT_V1", ballot_hash: "0x" + "a".repeat(64),
  blockchain_anchor_status: state, blockchain_tx_id: tx,
});

for (const state of ["pending", "submitted", "anchoring", "anchor_failed", "manual_review", "legacy_unanchored"])
  for (const tx of [null, transaction]) test(`${state}, transaction ${tx ? "present" : "absent"}: no false anchoring or verified seal`, () => {
    const row = record(state, tx);
    const status = receipt.getBlockchainStatusMeta(row);
    assert.equal(receipt.getNormalizedBlockchainStatus(row), state);
    assert.notEqual(status.className, "verified");
    assert.doesNotMatch(status.label, /complete|verified/i);
    assert.match(status.label + " " + status.detail, /recorded|saved/i);
    assert.notEqual(getBlockchainVerificationStatus(row), "Verified");
    assert.deepEqual(receipt.getVerificationCounts([row]), { anchored: 0, total: 1 });
    assert.equal(receipt.shouldPollBlockchainStatus(row), ["pending", "submitted", "anchoring", "anchor_failed"].includes(state));
    const group = { ballot: row, votes: [{ ballot_id: row.id, blockchain_anchor_status: "ballot_grouped" }] };
    assert.deepEqual(receipt.getReceiptBlockchainStatusMeta(group), status);
    assert.doesNotMatch(renderToStaticMarkup(createElement(list.BlockchainVerificationMachine, { status })), /class="[^"]*verified/);
    const progress = renderToStaticMarkup(createElement(list.BallotProgress, { status }));
    const steps = [...progress.matchAll(/<div class="(student-ballot-progress-step[^"]*)"><span>[^<]*<\/span><strong>([^<]+)<\/strong><\/div>/g)];
    const verifiedStep = steps.find(step => step[2] === "Verified");
    const processingStep = steps.find(step => step[2] === "Blockchain processing");
    assert.ok(verifiedStep && processingStep);
    assert.doesNotMatch(verifiedStep[1], /is-complete/);
    assert.doesNotMatch(processingStep[1], /is-complete/);
    assert.doesNotMatch(verification.getFinalState({ status }).headline, /Ballot Verified/);
    assert.notEqual(verification.getProofRecord({ isVerified: status.className === "verified", status }).className, "verified");
  });

test("only the explicit backend anchored state completes a receipt and verified count", () => {
  const row = { ...record("anchored", transaction), blockchain_network: "sepolia", blockchain_contract_address: "0x" + "c".repeat(40), blockchain_block_number: 123, blockchain_anchored_at: "2026-10-20T00:00:00Z" };
  const status = receipt.getBlockchainStatusMeta(row);
  assert.equal(status.className, "verified");
  assert.equal(status.label, "Blockchain verification complete.");
  assert.equal(getBlockchainVerificationStatus(row), "Verified");
  assert.deepEqual(receipt.getVerificationCounts([row]), { anchored: 1, total: 1 });
  assert.equal(receipt.shouldPollBlockchainStatus(row), false);
  assert.match(receipt.getVoteBlockchainDetail(row), /Anchored synthetic anchor time/);
  assert.equal(verification.getFinalState({ status }).headline, "Ballot Verified");
  assert.equal(verification.getProofRecord({ isVerified: true, status }).className, "verified");
  const progress = renderToStaticMarkup(createElement(list.BallotProgress, { status }));
  assert.match(progress, /student-ballot-progress-step is-complete is-current"><span>5<\/span><strong>Verified/);
});

test("a transaction ID, hash, block or timestamp without backend confirmation never suffices", () => {
  for (const state of [null, undefined, "unknown", "submitted", "anchor_failed"]) {
    const row = { ...record(state, transaction), blockchain_block_number: 123, blockchain_anchored_at: "2026-10-20T00:00:00Z" };
    assert.notEqual(receipt.getBlockchainStatusMeta(row).className, "verified");
    assert.notEqual(getBlockchainVerificationStatus(row), "Verified");
    assert.doesNotMatch(receipt.getVoteBlockchainDetail(row), /Anchored/);
  }
});

test("failed, unavailable and manual-review receipts remain distinct without automatic retry promises", () => {
  const delayed = receipt.getBlockchainStatusMeta(record("anchor_failed", transaction));
  const unavailable = receipt.getBlockchainStatusMeta(null);
  const review = receipt.getBlockchainStatusMeta(record("manual_review", transaction));
  assert.equal(verification.getFinalState({ status: delayed }).headline, "Verification Delayed");
  assert.equal(verification.getFinalState({ status: unavailable }).headline, "Verification Details Unavailable");
  assert.equal(verification.getFinalState({ status: review }).headline, "Verification Needs Review");
  for (const status of [delayed, unavailable, review]) {
    assert.match(verification.getFinalState({ status }).body, /recorded/i);
    assert.doesNotMatch(verification.getFinalState({ status }).body, /automatically|retrying/i);
  }
  assert.equal(verification.getProofRecord({ isVerified: false, status: delayed }).className, "delayed");
  assert.equal(verification.getProofRecord({ isVerified: false, status: unavailable }).className, "unavailable");
});

test("legacy summary and admin counters count backend-confirmed anchors, not transaction IDs", () => {
  const rows = [record("submitted", transaction), record("anchor_failed", transaction), record("anchored", transaction), record("manual_review", transaction)];
  assert.deepEqual(receipt.getVerificationCounts(rows), { anchored: 1, total: 4 });
  assert.match(receipt.getVerificationSummary(rows), /^1 of 4/);
  assert.doesNotMatch(receipt.getVerificationSummary([]), /All 0|verified on|complete/i);
  assert.deepEqual(getBlockchainVerificationCounts(rows), { verified: 1, pending: 2, needsReview: 1, missingHash: 0 });
});

test("transaction and manual-review guards still prevent duplicate manual anchoring", () => {
  for (const state of ["submitted", "anchored", "anchor_failed", "manual_review"]) {
    assert.equal(canRecordVoteHashOnChain({ ...record(state, transaction), vote_hash: "synthetic" }), false);
  }
  assert.equal(canRecordVoteHashOnChain({ blockchain_anchor_status: "manual_review", vote_hash: "synthetic" }), false);
  assert.equal(canRecordVoteHashOnChain({ ballot_id: "synthetic-ballot", vote_hash: "synthetic" }), false);
});

test("receipt pages and dialogs retain shared status derivation and honest success/time copy", () => {
  for (const name of ["Receipt", "ReceiptDetails", "BallotVerification"]) {
    const source = readFileSync(`src/pages/student/${name}.jsx`, "utf8");
    assert.match(source, /getReceiptBlockchainStatusMeta/);
    assert.match(source, /getBlockchainStatusMeta/);
    assert.doesNotMatch(source, /Verification continues automatically|Kandid will retry automatically/);
  }
  assert.match(readFileSync("src/pages/student/ReceiptDetails.jsx", "utf8"), /const timestamp = status\?\.className === "verified" && blockchainRecord\?\.blockchain_anchored_at/);
  assert.match(readFileSync("src/pages/student/BallotVerification.jsx", "utf8"), /const anchoredAt = isVerified && record\?\.blockchain_anchored_at/);
  const votePage = readFileSync("src/pages/student/VotePage.jsx", "utf8");
  assert.doesNotMatch(votePage, /Vote submitted and verified successfully/);
  assert.match(votePage, /Your vote is recorded\. Blockchain verification may still be processing\./);
});
