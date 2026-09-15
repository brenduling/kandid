import { supabase } from "../../lib/supabaseClient";
import {
  isMissingPositionOrderError,
  sortVotesByPositionOrder,
} from "../../utils/positionOrder";
import { formatAbsoluteTimestampAsManilaDateTime, parseUtcTimestamp } from "../../utils/time";

export const BLOCKCHAIN_POLL_INTERVAL_MS = 4000;
export const POLLING_BLOCKCHAIN_STATUSES = new Set(["pending", "anchoring", "submitted", "anchor_failed"]);
const STUDENT_BALLOT_RECEIPT_FUNCTION = "get-student-ballot-receipt";

export function getReceiptGroupKey(vote) {
  return vote.ballot_id || vote.election_id || vote.elections?.title || vote.id;
}

export function getNormalizedBlockchainStatus(record) {
  if (!record) return "unavailable";
  if (record?.blockchain_tx_id) return "anchored";
  if (record?.blockchain_anchor_status) return record.blockchain_anchor_status;
  if (record?.vote_hash || record?.ballot_hash) return "pending";
  return "pending";
}

export function shouldPollBlockchainStatus(record) {
  return POLLING_BLOCKCHAIN_STATUSES.has(getNormalizedBlockchainStatus(record));
}

export function getBlockchainStatusMeta(record) {
  const status = getNormalizedBlockchainStatus(record);

  if (status === "unavailable") {
    return {
      label: "Verification details unavailable",
      className: "delayed",
      detail: "Your vote is recorded. Verification details are temporarily unavailable.",
    };
  }

  if (record?.blockchain_tx_id || status === "anchored") {
    return {
      label: "Blockchain verification complete.",
      className: "verified",
      detail: "Your ballot integrity record has been anchored on Sepolia.",
    };
  }

  if (status === "anchoring" || status === "submitted") {
    return {
      label: "Your vote is recorded.",
      className: "anchoring",
      detail: "Blockchain verification is still processing. You do not need to wait here.",
    };
  }

  if (status === "anchor_failed") {
    return {
      label: "Your vote is recorded.",
      className: "delayed",
      detail: "Blockchain verification is temporarily delayed.",
    };
  }

  if (status === "manual_review") {
    return {
      label: "Verification completing",
      className: "review",
      detail: "Your vote remains recorded while Kandid completes its integrity verification.",
    };
  }

  if (status === "legacy_unanchored") {
    return {
      label: "Your vote is recorded.",
      className: "submitted",
      detail: "Your ballot has already been saved successfully.",
    };
  }

  return {
    label: "Your vote is recorded.",
    className: "pending",
    detail: "Blockchain verification is still processing. You do not need to wait here.",
  };
}

export function getReceiptBlockchainRecord(receipt) {
  if (receipt?.ballot) return receipt.ballot;
  if (receipt?.votes?.some((vote) => vote.ballot_id)) return null;
  return receipt?.votes?.find((vote) => vote.blockchain_tx_id) || receipt?.votes?.[0] || null;
}

export function getReceiptBlockchainStatusMeta(receipt) {
  return getBlockchainStatusMeta(getReceiptBlockchainRecord(receipt));
}

export function isBallotV1Receipt(receipt) {
  const record = getReceiptBlockchainRecord(receipt);
  return Boolean(
    receipt?.ballot?.id ||
    receipt?.votes?.some((vote) => vote.ballot_id) ||
    record?.hash_version === "KANDID_BALLOT_V1"
  );
}

export function getVerificationCounts(votes) {
  const anchored = votes.filter((vote) => getNormalizedBlockchainStatus(vote) === "anchored").length;

  return {
    anchored,
    total: votes.length,
  };
}

export function getVerificationSummary(votes) {
  const { anchored, total } = getVerificationCounts(votes);

  if (anchored === total) {
    return `All ${total} receipt ${total === 1 ? "record has" : "records have"} been verified on Sepolia.`;
  }

  if (anchored > 0) {
    return `${anchored} of ${total} receipt records secured.`;
  }

  return "Security verification is in progress.";
}

export function getVoteBlockchainDetail(vote) {
  const parts = [];

  if (vote.blockchain_network) parts.push(vote.blockchain_network);
  if (vote.blockchain_block_number) parts.push(`Block ${vote.blockchain_block_number}`);
  if (vote.blockchain_anchored_at) {
    parts.push(`Anchored ${formatAbsoluteTimestampAsManilaDateTime(vote.blockchain_anchored_at)}`);
  }

  return parts.join(" - ");
}

async function fetchStudentBallotReceipt({ electionId, ballotId }) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    return {
      data: null,
      error: new Error("Your session has expired. Please sign in again."),
    };
  }

  const { data, error } = await supabase.functions.invoke(
    STUDENT_BALLOT_RECEIPT_FUNCTION,
    {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: {
        election_id: Number(electionId),
        ...(ballotId ? { ballot_id: ballotId } : {}),
      },
    },
  );

  if (error) return { data: null, error };
  return { data: data?.data?.ballot || null, error: null };
}

async function enrichVotesWithBallots(votes) {
  const rows = votes || [];
  const ballotRequests = new Map();

  rows.forEach((vote) => {
    if (!vote.ballot_id || !vote.election_id) return;
    const key = `${vote.election_id}:${vote.ballot_id}`;
    if (!ballotRequests.has(key)) {
      ballotRequests.set(key, {
        electionId: vote.election_id,
        ballotId: vote.ballot_id,
      });
    }
  });

  if (ballotRequests.size === 0) return rows;

  const ballotResults = await Promise.all(
    [...ballotRequests.entries()].map(async ([key, request]) => {
      const { data, error } = await fetchStudentBallotReceipt(request);
      return [key, { data, error }];
    }),
  );
  const ballotsByKey = new Map(ballotResults);

  return rows.map((vote) => {
    if (!vote.ballot_id || !vote.election_id) return vote;

    const result = ballotsByKey.get(`${vote.election_id}:${vote.ballot_id}`);
    if (!result?.data) {
      return {
        ...vote,
        ballot: null,
        ballotVerificationUnavailable: Boolean(result?.error),
      };
    }

    if (
      String(result.data.ballot_id || result.data.id) !== String(vote.ballot_id) ||
      Number(result.data.election_id) !== Number(vote.election_id)
    ) {
      return {
        ...vote,
        ballot: null,
        ballotVerificationUnavailable: true,
      };
    }

    return {
      ...vote,
      ballot: result.data,
      ballotVerificationUnavailable: false,
    };
  });
}

export async function fetchStudentVotes(studentId) {
  const withDisplayOrder = `
      id,
      student_id,
      election_id,
      position_id,
      candidate_id,
      is_abstain,
      ballot_id,
      vote_hash,
      blockchain_anchor_status,
      hash_version,
      blockchain_network,
      blockchain_block_number,
      blockchain_anchored_at,
      blockchain_tx_id,
      vote_timestamp,
      elections (
        title,
        organizations (
          name
        )
      ),
      positions (
        id,
        name,
        display_order
      )
    `;
  const legacySelect = withDisplayOrder.replace(",\n        display_order", "");

  const result = await supabase
    .from("votes")
    .select(withDisplayOrder)
    .eq("student_id", studentId)
    .order("vote_timestamp", { ascending: false });

  if (!isMissingPositionOrderError(result.error)) {
    if (result.error) return result;

    return {
      ...result,
      data: await enrichVotesWithBallots(result.data),
    };
  }

  const legacyResult = await supabase
    .from("votes")
    .select(legacySelect)
    .eq("student_id", studentId)
    .order("vote_timestamp", { ascending: false });

  if (legacyResult.error) return legacyResult;

  return {
    ...legacyResult,
    data: await enrichVotesWithBallots(legacyResult.data),
  };
}

export function normalizeReceiptVotes(votes) {
  return (votes || []).map((vote) => ({
    ...vote,
    positions: {
      ...vote.positions,
      display_order: vote.positions?.display_order || vote.position_id,
    },
    ballot: vote.ballot || null,
    ballotVerificationUnavailable: Boolean(vote.ballotVerificationUnavailable),
  }));
}

export function groupReceiptVotes(votes) {
  const groups = new Map();

  votes.forEach((vote) => {
    const key = getReceiptGroupKey(vote);
    const current = groups.get(key) || {
      key,
      organizationName: vote.elections?.organizations?.name || "Organization",
      electionTitle: vote.elections?.title || "Election",
      submittedAt: vote.vote_timestamp,
      ballot: vote.ballot || null,
      ballotVerificationUnavailable: Boolean(vote.ballot_id && !vote.ballot),
      votes: [],
    };

    current.votes.push(vote);
    if (vote.ballot) current.ballot = vote.ballot;
    if (vote.ballotVerificationUnavailable) current.ballotVerificationUnavailable = true;

    if (
      vote.vote_timestamp &&
      (!current.submittedAt || parseUtcTimestamp(vote.vote_timestamp) > parseUtcTimestamp(current.submittedAt))
    ) {
      current.submittedAt = vote.vote_timestamp;
    }

    groups.set(key, current);
  });

  return [...groups.values()].map((group) => ({
    ...group,
    votes: sortVotesByPositionOrder(group.votes),
  }));
}
