import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { OrganizationLogo } from "../../components/KandidImage";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { getBlockchainExplorerTxUrl } from "../../utils/blockchain";
import {
  fetchStudentVotes,
  getBlockchainStatusMeta,
  getReceiptBlockchainRecord,
  getReceiptBlockchainStatusMeta,
  groupReceiptVotes,
  isBallotV1Receipt,
  normalizeReceiptVotes,
} from "./receiptData";
import {
  formatAbsoluteTimestampAsManilaDateTime,
  formatUtcTimestampAsManilaDateTime,
} from "../../utils/time";

function shortenHash(hash, head = 6, tail = 6) {
  if (!hash) return "";
  const text = String(hash);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function formatBlockNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num.toLocaleString() : "";
}

function formatNetworkName(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text === "sepolia") return "Sepolia";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getFinalState({ status, ballotVerificationUnavailable, network }) {
  const className = status?.className || "";
  const label = status?.label || "";

  if (className === "verified") {
    return {
      headline: "Ballot Verified",
      body:
        "The fingerprint recorded by Kandid matches the fingerprint secured on the blockchain.",
    };
  }

  const unavailable =
    ballotVerificationUnavailable ||
    (className === "delayed" && !/temporarily delayed/i.test(label));

  if (unavailable) {
    return {
      headline: "Verification Details Unavailable",
      body:
        "Your ballot was recorded in Kandid. The blockchain verification record could not be displayed right now.",
    };
  }

  if (className === "delayed") {
    return {
      headline: "Verification Delayed",
      body:
        "Your ballot is safe. The integrity record is temporarily delayed, and Kandid will retry automatically.",
    };
  }

  if (className === "review") {
    return {
      headline: "Verification Completing",
      body: "Your ballot was submitted successfully. Kandid is completing its verification.",
    };
  }

  if (/historical/i.test(label)) {
    return {
      headline: "Ballot Recorded",
      body:
        "Your ballot was recorded in Kandid. This receipt keeps its original integrity verification.",
    };
  }

  return {
    headline: "Ballot Submitted",
    body:
      "Your ballot was submitted successfully, and Kandid is still completing its blockchain verification.",
  };
}

function getProofRecord({ isVerified, status, network }) {
  if (isVerified) {
    return {
      text: `✓ Recorded on ${network || "the blockchain"}`,
      className: "verified",
    };
  }

  const label = status?.label || "";
  const className = status?.className || "";

  if (className === "delayed") {
    return /temporarily delayed/i.test(label)
      ? { text: "Record delayed — Kandid is retrying", className: "delayed" }
      : { text: "Record details unavailable", className: "unavailable" };
  }

  if (className === "review") {
    return { text: "Record in review", className: "review" };
  }

  if (/historical/i.test(label)) {
    return { text: "Original record kept", className: "recorded" };
  }

  return { text: "Record in progress", className: "pending" };
}

function DownChevron() {
  return (
    <svg
      className="junction-chevron"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 2.5 L5 7.5 L9 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
    </svg>
  );
}

function FingerprintConvergence() {
  return (
    <svg
      className="junction-convergence"
      viewBox="0 0 220 64"
      aria-hidden="true"
      focusable="false"
    >
      <g className="jc-lines">
        <line x1="34" y1="0" x2="110" y2="40" />
        <line x1="110" y1="0" x2="110" y2="40" />
        <line x1="186" y1="0" x2="110" y2="40" />
      </g>
      <line className="jc-lines" x1="110" y1="44" x2="110" y2="56" />
      <path
        className="jc-arrow"
        d="M102.5 49 L110 57 L117.5 49"
        fill="none"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function BallotVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  const { voteId } = useParams();
  const user = JSON.parse(localStorage.getItem("user"));
  const routeVote = location.state?.vote || null;
  const routeReceipt = location.state?.receipt || null;

  const [votes, setVotes] = useState(routeVote ? [routeVote] : []);
  const [loading, setLoading] = useState(!routeVote);
  const [loadError, setLoadError] = useState("");

  const loadVotes = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    const { data, error } = await fetchStudentVotes(user.id);

    if (error) {
      console.error("Failed to load verification details:", error);
      setLoadError(error.message || "Unable to load verification details.");
      setLoading(false);
      return;
    }

    setVotes(normalizeReceiptVotes(data));
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      loadVotes();
    }, 0);

    return () => window.clearTimeout(loadId);
  }, [loadVotes]);

  const currentIndex = useMemo(
    () => votes.findIndex((vote) => String(vote.id) === String(voteId)),
    [voteId, votes],
  );

  const receiptGroups = useMemo(() => groupReceiptVotes(votes), [votes]);
  const currentVote = currentIndex >= 0 ? votes[currentIndex] : routeVote;
  const currentReceipt =
    receiptGroups.find((receipt) =>
      receipt.votes.some((vote) => String(vote.id) === String(voteId)),
    ) ||
    routeReceipt ||
    (currentVote
      ? {
          key: currentVote.ballot_id || currentVote.election_id || currentVote.id,
          electionTitle: currentVote.elections?.title || "Election",
          organizationName:
            currentVote.elections?.organizations?.name || "Organization",
          organizationDescription:
            currentVote.elections?.organizations?.description || "",
          organizationLogoUrl:
            currentVote.elections?.organizations?.logo_url || "",
          submittedAt: currentVote.vote_timestamp,
          ballot: currentVote.ballot || null,
          votes: [currentVote],
        }
      : null);

  const isBallotV1 = isBallotV1Receipt(currentReceipt);
  const blockchainRecord = isBallotV1
    ? getReceiptBlockchainRecord(currentReceipt)
    : currentVote;
  const status = isBallotV1
    ? getReceiptBlockchainStatusMeta(currentReceipt)
    : blockchainRecord
      ? getBlockchainStatusMeta(blockchainRecord)
      : null;
  const isVerified = status?.className === "verified";

  const receipt = currentReceipt;
  const record = blockchainRecord || null;
  const network = formatNetworkName(record?.blockchain_network || "");
  const hasSepoliaRecord =
    record?.blockchain_network === "sepolia" && Boolean(record?.blockchain_tx_id);
  const explorerUrl = hasSepoliaRecord
    ? getBlockchainExplorerTxUrl(record.blockchain_tx_id)
    : "";
  const blockNumber = record?.blockchain_block_number
    ? formatBlockNumber(record.blockchain_block_number)
    : "";
  const txId = record?.blockchain_tx_id || "";
  const anchoredAt = record?.blockchain_anchored_at
    ? formatAbsoluteTimestampAsManilaDateTime(record.blockchain_anchored_at)
    : "";
  const ballotHash = record?.ballot_hash || "";
  const submittedAt = receipt?.submittedAt
    ? formatUtcTimestampAsManilaDateTime(receipt.submittedAt)
    : "";

  const proofHash = ballotHash || currentVote?.vote_hash || "";
  const proofRecord = getProofRecord({
    isVerified,
    status,
    network,
  });
  const showMatch = isVerified && Boolean(ballotHash);

  const finalState = getFinalState({
    status,
    ballotVerificationUnavailable: Boolean(
      currentReceipt?.ballotVerificationUnavailable,
    ),
    network: record?.blockchain_network || "",
  });

  function goBack() {
    navigate("/student/receipt");
  }

  if (loading) {
    return (
      <div className="student-verification">
        <StudentSkeletonGroup label="Loading ballot verification">
          <header className="student-verification-opening">
            <div className="student-skeleton-stack">
              <StudentSkeletonLine width="30%" height="0.6rem" />
              <StudentSkeletonLine width="68%" height="1.5rem" />
              <StudentSkeletonLine width="88%" height="0.7rem" />
              <StudentSkeletonLine width="70%" height="0.7rem" />
            </div>
          </header>

          <div className="student-verification-context">
            <StudentSkeletonLine
              variant="media"
              width="3rem"
              height="3rem"
            />

            <div className="student-skeleton-copy">
              <StudentSkeletonLine width="44%" height="0.85rem" />
              <StudentSkeletonLine width="62%" height="0.6rem" />
            </div>

            <div className="student-skeleton-copy">
              <StudentSkeletonLine width="30%" height="0.6rem" />
              <StudentSkeletonLine width="52%" height="0.7rem" />
            </div>
          </div>

          <div className="student-skeleton-stack student-verification-skeleton-journey">
            <StudentSkeletonLine width="100%" height="0.7rem" />
            <StudentSkeletonLine width="92%" height="0.7rem" />
            <StudentSkeletonLine width="100%" height="0.7rem" />
            <StudentSkeletonLine width="64%" height="0.7rem" />
          </div>
        </StudentSkeletonGroup>
      </div>
    );
  }

  if (loadError || !receipt || !status) {
    return (
      <div className="student-verification">
        <div className="student-verification-state">
          <p className="font-bold text-rose-600">Unable to load verification.</p>
          <p className="student-verification-state-detail">
            {loadError || "Receipt record not found."}
          </p>
          <button type="button" onClick={() => navigate("/student/receipt")} className="student-outline-btn">
            Back to Receipts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="student-verification">
      <button type="button" className="student-verification-back" onClick={goBack}>
        <ArrowLeft size={14} />
        Receipt
      </button>

      <header className="student-verification-opening">
        <span className="student-verification-kicker">Your Ballot Proof</span>
        <h1>How your ballot was protected.</h1>
        <p>
          A simple look at how Kandid created and secured the integrity record
          for this ballot.
        </p>
      </header>

      <div className="student-verification-context">
        {receipt.organizationLogoUrl ? (
          <OrganizationLogo
            organization={{
              name: receipt.organizationName,
              description: receipt.organizationDescription,
              logo_url: receipt.organizationLogoUrl,
            }}
            className="student-verification-org-logo"
          />
        ) : null}
        <div className="student-verification-context-org">
          <strong>{receipt.organizationName}</strong>
          {receipt.organizationDescription ? (
            <span>{receipt.organizationDescription}</span>
          ) : null}
        </div>
        <div className="student-verification-context-stat">
          <span>Election</span>
          <strong>{receipt.electionTitle}</strong>
        </div>
        <div className="student-verification-context-stat">
          <span>Submitted</span>
          <strong>{submittedAt}</strong>
        </div>
        <div className="student-verification-context-stat">
          <span>Selections</span>
          <strong>{receipt.votes.length}</strong>
        </div>
      </div>

      <ol className="student-verification-journey">
        <li className="junction-step">
          <div className="junction-rail">
            <span className="junction-node">01</span>
            <DownChevron />
            <span className="junction-run" />
          </div>
          <div className="junction-content">
            <div className="junction-step-head">
              <h2>Your Ballot</h2>
              <span className="junction-step-count">
                {receipt.votes.length}{" "}
                {receipt.votes.length === 1 ? "selection" : "selections"} recorded
              </span>
            </div>
            <p className="junction-note">
              Your selections were recorded as one submitted ballot.
            </p>
          </div>
        </li>

        <li className="junction-step">
          <div className="junction-rail">
            <span className="junction-node">02</span>
            <DownChevron />
            <span className="junction-run" />
          </div>
          <div className="junction-content">
            <div className="junction-step-head">
              <h2>Integrity Fingerprints</h2>
            </div>
            <ul className="junction-fingerprint-list">
              {receipt.votes.map((vote) => (
                <li key={vote.id} className="junction-fingerprint">
                  <strong>{vote.positions?.name || "Selection"}</strong>
                  {vote.is_abstain ? <em>Abstained</em> : null}
                  <code>{shortenHash(vote.vote_hash)}</code>
                </li>
              ))}
            </ul>
            <FingerprintConvergence />
            <p className="junction-note">
              Each selection fingerprint contributes to one ballot integrity record.
            </p>
          </div>
        </li>

        <li className="junction-step">
          <div className="junction-rail">
            <span className="junction-node">03</span>
            <DownChevron />
            <span className="junction-run" />
          </div>
          <div className="junction-content">
            <div className="junction-step-head">
              <h2>Ballot Sealed</h2>
            </div>
            <div className="junction-seal">
              {ballotHash ? (
                <>
                  <span className="junction-seal-label">Ballot Integrity Fingerprint</span>
                  <code>{shortenHash(ballotHash, 6, 6)}</code>
                </>
              ) : (
                <p className="junction-seal-note">
                  The ballot integrity fingerprint will appear here once the
                  trusted receipt returns it. Kandid still recorded this ballot
                  securely.
                </p>
              )}
            </div>
            <p className="junction-note">
              All your fingerprints are sealed into one ballot integrity record.
            </p>
          </div>
        </li>

        <li className="junction-step">
          <div className="junction-rail">
            <span className="junction-node">04</span>
            <DownChevron />
            <span className="junction-run" />
          </div>
          <div className="junction-content">
            <div className="junction-step-head">
              <h2>Blockchain Record</h2>
            </div>
            {blockNumber ? (
              <span className="junction-block-label">Block {blockNumber}</span>
            ) : null}
            <div className="junction-proof">
              <span className="junction-proof-label">Your Ballot Fingerprint</span>
              <code>
                {proofHash
                  ? shortenHash(proofHash, 10, 6)
                  : "Awaiting the integrity record"}
              </code>
              <span
                className={`junction-proof-status is-${proofRecord.className}`}
              >
                {proofRecord.text}
              </span>
            </div>
            <p className="junction-note">
              Simple representation of your blockchain proof.
            </p>
          </div>
        </li>
      </ol>

      <div className="junction-final">
        <div className="junction-rail">
          <span className="junction-run" />
          <span className={`junction-terminal ${isVerified ? "is-verified" : ""}`}>
            {isVerified ? <ShieldCheck size={13} strokeWidth={2.5} /> : null}
          </span>
        </div>
        <div className="junction-content">
          {showMatch ? (
            <div className="junction-match">
              <div className="junction-record">
                <span>Kandid Ballot Record</span>
                <code>{shortenHash(ballotHash, 8, 6)}</code>
              </div>
              <span className="junction-equal" aria-hidden="true">=</span>
              <div className="junction-record">
                <span>Blockchain Record</span>
                <code>{shortenHash(ballotHash, 8, 6)}</code>
              </div>
              <div className="junction-match-result">
                <ShieldCheck size={15} />
                Match
              </div>
            </div>
          ) : null}

          <section className="junction-final-seal">
            <div className={`junction-verdict ${status.className || ""}`}>
              {isVerified ? <ShieldCheck size={18} /> : null}
              <strong>{isVerified ? "✓ Ballot Verified" : finalState.headline}</strong>
            </div>
            <p className="junction-verdict-copy">{finalState.body}</p>

            <div className="junction-why">
              <h3>Why This Matters</h3>
              <p>
                If the protected ballot record changed, its fingerprint would
                change too. It would no longer match the fingerprint recorded
                for this ballot.
              </p>
            </div>
            <p className="junction-privacy">
              Your vote choices are not published on the blockchain.
            </p>
          </section>
        </div>
      </div>

      <details className="student-verification-technical">
        <summary>Technical Details</summary>
        <div className="student-verification-technical-grid">
          {network ? (
            <div className="student-verification-technical-row">
              <span>Network</span>
              <strong>{network}</strong>
            </div>
          ) : null}
          {blockNumber ? (
            <div className="student-verification-technical-row">
              <span>Block Number</span>
              <strong>{blockNumber}</strong>
            </div>
          ) : null}
          {txId ? (
            <div className="student-verification-technical-row">
              <span>Transaction ID</span>
              <code>{txId}</code>
            </div>
          ) : null}
          {anchoredAt ? (
            <div className="student-verification-technical-row">
              <span>Recorded</span>
              <strong>{anchoredAt}</strong>
            </div>
          ) : null}
          {ballotHash ? (
            <div className="student-verification-technical-row">
              <span>Ballot Integrity Hash</span>
              <code>{ballotHash}</code>
            </div>
          ) : null}
        </div>
      </details>

      {explorerUrl ? (
        <a
          className="student-verification-explorer"
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Sepolia Explorer
          <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
}

export default BallotVerification;