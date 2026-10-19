import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  NOTIFICATION_STALE_AFTER_MS,
  shouldRefreshNotifications,
} from "../src/utils/notificationRefresh.js";
import {
  getReceiptPollDelayMs,
  RECEIPT_AUTO_POLL_MAX_MS,
  shouldContinueReceiptAutoPolling,
} from "../src/utils/receiptPolling.js";
import {
  canRecordVoteHashOnChain,
  getBlockchainVerificationCounts,
  getBlockchainVerificationStatus,
} from "../src/utils/blockchainVerification.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [anchorWorker, anchorMigration, notificationCenter, receiptPage, receiptData,
  blockchainPage, mobileHeader, studentLayout, boardLayout, superAdminLayout] = await Promise.all([
  read("supabase/functions/anchor-vote-hashes/index.ts"),
  read("supabase/migrations/20261004100000_bound_vote_anchor_retries.sql"),
  read("src/components/NotificationCenter.jsx"),
  read("src/pages/student/Receipt.jsx"),
  read("src/pages/student/receiptData.js"),
  read("src/pages/superadmin/BlockchainVerification.jsx"),
  read("src/components/MobileHeader.jsx"),
  read("src/layouts/StudentLayout.jsx"),
  read("src/layouts/BoardLayout.jsx"),
  read("src/layouts/SuperAdminLayout.jsx"),
]);

test("anchor worker idles before blockchain initialization and processes at most two claims", () => {
  const claim = anchorWorker.indexOf('"claim_next_vote_anchor"');
  const noWork = anchorWorker.indexOf("if (!claimed)");
  const idleReturn = anchorWorker.indexOf('status: "idle"');
  const provider = anchorWorker.indexOf("new ethers.JsonRpcProvider");
  const ownerCheck = anchorWorker.indexOf("await contract.owner()");
  const recordHash = anchorWorker.indexOf("await contract.recordVoteHash(voteHash)");

  assert.ok(claim >= 0 && noWork > claim && idleReturn > noWork);
  assert.ok(provider > noWork && ownerCheck > provider && recordHash > ownerCheck);
  assert.match(anchorWorker, /MAX_VOTES_PER_RUN\s*=\s*2/);
  assert.match(anchorWorker, /await adminClient\.rpc\(\s*"mark_vote_anchor_success"/);
  assert.match(anchorWorker, /await adminClient\.rpc\(\s*"mark_vote_anchor_failure"/);
  assert.match(anchorWorker, /x-anchor-worker-token/);
});

test("ordinary anchor failures always remain retryable with bounded capped backoff", () => {
  const failureFunction = anchorMigration.match(
    /create or replace function public\.mark_vote_anchor_failure\([\s\S]*?\$function\$;/i,
  )?.[0];
  assert.ok(failureFunction, "failure RPC should be defined in the retry migration");
  assert.match(anchorMigration, /add column if not exists blockchain_next_retry_at timestamptz/i);
  assert.match(anchorMigration, /update public\.votes as v[\s\S]*?blockchain_anchor_status = 'anchor_failed'[\s\S]*?blockchain_next_retry_at is null/i);
  assert.match(anchorMigration, /when coalesce\(v\.blockchain_retry_count, 0\) <= 1 then interval '1 minute'/i);
  assert.match(anchorMigration, /when v\.blockchain_retry_count = 4 then interval '60 minutes'[\s\S]*?else interval '6 hours'/i);
  assert.match(anchorMigration, /blockchain_anchor_status in \('pending', 'anchor_failed'\)/i);
  assert.match(anchorMigration, /for update skip locked/i);
  assert.match(failureFunction, /v_next_status := 'anchor_failed'/i);
  assert.match(failureFunction, /when 1 then[\s\S]*?interval '1 minute'/i);
  assert.match(failureFunction, /when 2 then[\s\S]*?interval '5 minutes'/i);
  assert.match(failureFunction, /when 3 then[\s\S]*?interval '15 minutes'/i);
  assert.match(failureFunction, /when 4 then[\s\S]*?interval '60 minutes'/i);
  assert.match(failureFunction, /else pg_catalog\.clock_timestamp\(\) \+ interval '6 hours'/i);
  assert.match(failureFunction, /blockchain_retry_count = v_next_retry_count/i);
  assert.doesNotMatch(failureFunction, /manual_review|v_max_retries/i);
  assert.doesNotMatch(anchorMigration, /retry_count\s*>=\s*5[\s\S]{0,160}manual_review/i);
  assert.match(failureFunction, /2147483647/); // diagnostic count saturates without integer overflow
});

test("anchored and manual-review rows are terminal; pending and stale claims recover safely", () => {
  const claimFunction = anchorMigration.match(
    /create or replace function public\.claim_next_vote_anchor\(\)[\s\S]*?\$function\$;/i,
  )?.[0];
  assert.ok(claimFunction);
  assert.match(claimFunction, /blockchain_anchor_status in \('pending', 'anchor_failed'\)/i);
  assert.match(claimFunction, /blockchain_anchor_status = 'anchoring'/i);
  assert.match(claimFunction, /blockchain_anchor_claimed_at[\s\S]*?interval '10 minutes'/i);
  assert.match(claimFunction, /for update skip locked/i);
  assert.doesNotMatch(claimFunction, /blockchain_anchor_status\s*=\s*'manual_review'/i);
  assert.doesNotMatch(claimFunction, /blockchain_anchor_status\s*=\s*'anchored'/i);
  assert.match(claimFunction, /when v_was_stale_claim[\s\S]*?then coalesce\(v\.blockchain_retry_count, 0\) \+ 1/i);
  assert.match(anchorMigration, /revoke all on function public\.claim_next_vote_anchor\(\) from public, anon, authenticated/i);
  assert.match(anchorMigration, /to service_role/i);
  assert.doesNotMatch(anchorMigration, /grant\s+[^;]*(?:insert|update|delete)\s+on\s+table\s+public\.votes/i);
});

test("already-recorded hashes enter manual review and are never submitted a second time", () => {
  const alreadyRecorded = anchorWorker.indexOf("if (alreadyRecorded)");
  const manualReview = anchorWorker.indexOf('"mark_vote_anchor_manual_review"', alreadyRecorded);
  const resubmit = anchorWorker.indexOf("contract.recordVoteHash(voteHash)");
  assert.ok(alreadyRecorded >= 0 && manualReview > alreadyRecorded && resubmit > manualReview);
  assert.match(anchorWorker.slice(alreadyRecorded, resubmit), /continue;/);
  const manualFunction = anchorMigration.match(
    /create or replace function public\.mark_vote_anchor_manual_review\([\s\S]*?\$function\$;/i,
  )?.[0];
  assert.ok(manualFunction);
  assert.match(manualFunction, /blockchain_anchor_status = 'manual_review'/i);
  assert.match(manualFunction, /blockchain_next_retry_at = null/i);
  assert.match(manualFunction, /blockchain_anchor_status = 'anchoring'/i);
});

test("Super Admin manual-review records are separate from Pending and cannot use Record On-Chain", () => {
  const votes = [
    { blockchain_anchor_status: "pending", vote_hash: "0x1" },
    { blockchain_anchor_status: "anchor_failed", vote_hash: "0x2" },
    { blockchain_anchor_status: "manual_review", vote_hash: "0x3" },
    { blockchain_anchor_status: "anchored", vote_hash: "0x4", blockchain_tx_id: "tx" },
    { blockchain_anchor_status: "pending" },
  ];
  assert.equal(getBlockchainVerificationStatus(votes[2]), "Needs Review");
  assert.equal(canRecordVoteHashOnChain(votes[2]), false);
  assert.equal(canRecordVoteHashOnChain(votes[0]), true);
  assert.deepEqual(getBlockchainVerificationCounts(votes), {
    verified: 1,
    pending: 2,
    needsReview: 1,
    missingHash: 1,
  });
  assert.match(blockchainPage, /Needs Review/);
  assert.match(blockchainPage, /getBlockchainVerificationCounts\(votes\)/);
  assert.match(blockchainPage, /canRecordVoteHashOnChain\(vote\)/);
});

test("notifications refresh on events, navigation, and a five-minute visible-only fallback", () => {
  const now = 1_000_000;
  assert.equal(NOTIFICATION_STALE_AFTER_MS, 5 * 60 * 1000);
  assert.equal(shouldRefreshNotifications(0, now), true);
  assert.equal(shouldRefreshNotifications(now - NOTIFICATION_STALE_AFTER_MS + 1, now), false);
  assert.equal(shouldRefreshNotifications(now - NOTIFICATION_STALE_AFTER_MS, now), true);
  assert.doesNotMatch(notificationCenter, /setInterval\s*\(/);
  assert.match(notificationCenter, /NOTIFICATION_STALE_AFTER_MS/);
  assert.match(notificationCenter, /document\.visibilityState === "hidden"/);
  assert.match(notificationCenter, /window\.clearTimeout\(refreshTimer\)/);
  assert.match(notificationCenter, /kandid-audit-updated/);
  assert.match(notificationCenter, /kandid-user-updated/);
  assert.match(notificationCenter, /window\.addEventListener\("focus"/);
  assert.match(notificationCenter, /window\.addEventListener\("online"/);
  assert.match(notificationCenter, /location\.key/);
  assert.match(notificationCenter, /let inFlight = false/);
});

test("notification identity cleanup blocks stale user responses and desktop/mobile mounts do not duplicate polling", () => {
  const resultGuard = notificationCenter.indexOf("if (!active) return;");
  const stateWrite = notificationCenter.indexOf("setNotifications(items)");
  assert.ok(resultGuard >= 0 && resultGuard < stateWrite);
  assert.match(notificationCenter, /active = false;/);
  assert.doesNotMatch(notificationCenter, /loadingRef\.current/);
  assert.match(notificationCenter, /placement === "desktop" && isDesktopViewport/);
  assert.match(notificationCenter, /placement === "mobile" && !isDesktopViewport/);
  assert.match(mobileHeader, /placement="mobile"/);
  assert.match(studentLayout, /placement="desktop"/);
  assert.match(boardLayout, /placement="desktop"/);
  assert.match(superAdminLayout, /placement="desktop"/);
});

test("manual-review receipts are terminal, non-polled, and explain that the vote remains recorded", () => {
  assert.match(receiptData, /POLLING_BLOCKCHAIN_STATUSES = new Set\(\["pending", "anchoring", "submitted", "anchor_failed"\]\)/);
  assert.doesNotMatch(receiptData.match(/POLLING_BLOCKCHAIN_STATUSES[^;]+/)?.[0] || "", /manual_review/);
  assert.match(receiptData, /label: "Verification needs review"/);
  assert.match(receiptData, /Your vote was recorded successfully, but its blockchain verification requires additional review\./);
  assert.match(receiptPage, /shouldPollBlockchainStatus/);
});

test("receipt polling retains progressive delays, timeout, and a manual refresh path", () => {
  const startedAt = 50_000;
  assert.deepEqual(
    [0, 1, 2, 3, 8].map(getReceiptPollDelayMs),
    [5_000, 10_000, 20_000, 30_000, 30_000],
  );
  assert.equal(RECEIPT_AUTO_POLL_MAX_MS, 5 * 60 * 1000);
  assert.equal(shouldContinueReceiptAutoPolling(startedAt, startedAt + RECEIPT_AUTO_POLL_MAX_MS - 1), true);
  assert.equal(shouldContinueReceiptAutoPolling(startedAt, startedAt + RECEIPT_AUTO_POLL_MAX_MS), false);
  assert.match(receiptPage, /window\.setTimeout\(async/);
  assert.match(receiptPage, /window\.clearTimeout\(refreshId\)/);
  assert.match(receiptPage, /Automatic updates paused\. Use Refresh to check again\./);
  assert.match(receiptPage, /isFetchingRef\.current/);
  assert.doesNotMatch(receiptPage, /window\.setInterval\(\s*\(\)\s*=>\s*\{\s*loadVotes/);
});
