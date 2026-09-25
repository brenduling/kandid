import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { OrganizationLogo } from "../../components/KandidImage";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { formatUtcTimestampAsManilaDate, formatUtcTimestampAsManilaDateTime } from "../../utils/time";
import {
  BLOCKCHAIN_POLL_INTERVAL_MS,
  fetchStudentVotes,
  getBlockchainStatusMeta,
  getNormalizedBlockchainStatus,
  getReceiptBlockchainRecord,
  getReceiptBlockchainStatusMeta,
  getVerificationCounts,
  getVerificationSummary,
  getVoteBlockchainDetail,
  groupReceiptVotes,
  isBallotV1Receipt,
  normalizeReceiptVotes,
  shouldPollBlockchainStatus,
} from "./receiptData";

export function BlockchainVerificationMachine({ status }) {
  const isVerified = status.className === "verified";

  return (
    <div
      className={`student-blockchain-machine ${status.className}`}
      aria-label={`Receipt security verification status: ${status.label}`}
    >
      <div className="student-blockchain-machine-slot" aria-hidden="true" />
      <div className="student-blockchain-machine-body" aria-hidden="true">
        <span className="student-blockchain-machine-light" />
        <span className="student-blockchain-machine-roller" />
        <span className="student-blockchain-machine-roller" />
      </div>
      <div className="student-blockchain-machine-paper" aria-hidden="true">
        <span />
        <span />
        {isVerified ? <ShieldCheck size={14} /> : null}
      </div>
      <div className="student-blockchain-machine-progress" aria-hidden="true" />
    </div>
  );
}

function BallotSealVisual({ status }) {
  const isVerified = status.className === "verified";
  const sealLabel = isVerified
    ? "Verified"
    : status.className === "anchoring"
      ? "Verifying"
      : "Recorded";

  return (
    <div className={`student-ballot-seal ${status.className}`} aria-hidden="true">
      <div className="student-ballot-seal-paper">
        <span />
        <span />
        <span />
      </div>
      <div className="student-ballot-seal-stamp">
        <ShieldCheck size={24} />
      </div>
      <strong>{sealLabel}</strong>
    </div>
  );
}

function shortenIdentifier(value) {
  if (!value) return "";
  if (value.length <= 20) return value;

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function SelectionIntegrityHash({ value }) {
  const [copied, setCopied] = useState(false);

  async function copyHash() {
    if (!value || !navigator.clipboard) return;

    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="student-ballot-selection-hash">
      <span>Selection Integrity Hash</span>
      <div>
        <code title={value || ""}>{value ? shortenIdentifier(value) : "Pending hash"}</code>
        {value ? (
          <button type="button" onClick={copyHash} aria-label="Copy selection integrity hash">
            <Copy size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BallotProgress({ status }) {
  const steps = [
    "Vote cast",
    "Ballot sealed",
    "Receipt recorded",
    "Secured",
    "Verified",
  ];
  const activeIndex = status.className === "verified"
    ? 4
    : status.className === "anchoring" || status.className === "delayed" || status.className === "review"
      ? 3
      : 2;

  return (
    <div className="student-ballot-progress" aria-label={status.label}>
      {steps.map((step, index) => (
        <div
          key={step}
          className={`student-ballot-progress-step ${index <= activeIndex ? "is-complete" : ""} ${index === activeIndex ? "is-current" : ""}`}
        >
          <span>{index < activeIndex ? "OK" : index + 1}</span>
          <strong>{step}</strong>
        </div>
      ))}
    </div>
  );
}

function StudentReceipt() {
  const navigate = useNavigate();
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedReceipts, setExpandedReceipts] = useState({});
  const isFetchingRef = useRef(false);
  const pollingErrorLoggedRef = useRef(false);
  const user = JSON.parse(localStorage.getItem("user"));

  const loadVotes = useCallback(async ({ active = () => true, silent = false } = {}) => {
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;

    if (!silent) {
      setLoading(true);
      setLoadError("");
    }

    try {
      const { data, error } = await fetchStudentVotes(user.id);

      if (!active()) return;

      if (error) {
        if (silent) {
          if (!pollingErrorLoggedRef.current) {
            console.warn("Temporary receipt refresh failed:", error);
            pollingErrorLoggedRef.current = true;
          }
          return;
        }

        console.error("Failed to load student receipts:", error);
        setLoadError(error.message || "Unable to load vote receipts.");
        setVotes([]);
        return;
      }

      pollingErrorLoggedRef.current = false;

      setVotes(normalizeReceiptVotes(data));
    } finally {
      isFetchingRef.current = false;

      if (active() && !silent) {
        setLoading(false);
      }
    }
  }, [user.id]);

  useEffect(() => {
    let mounted = true;
    const initialLoadId = window.setTimeout(() => {
      loadVotes({ active: () => mounted });
    }, 0);

    return () => {
      mounted = false;
      window.clearTimeout(initialLoadId);
    };
  }, [loadVotes]);

  const receiptGroups = useMemo(() => {
    return groupReceiptVotes(votes);
  }, [votes]);

  const shouldPollReceipts = useMemo(
    () => receiptGroups.some((receipt) => shouldPollBlockchainStatus(getReceiptBlockchainRecord(receipt))),
    [receiptGroups],
  );

  const shouldPollLegacyVotes = useMemo(
    () => votes.some((vote) => !vote.ballot_id && shouldPollBlockchainStatus(vote)),
    [votes],
  );

  useEffect(() => {
    if (!shouldPollReceipts && !shouldPollLegacyVotes) return undefined;

    let mounted = true;
    const refreshId = window.setInterval(() => {
      loadVotes({ active: () => mounted, silent: true });
    }, BLOCKCHAIN_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(refreshId);
    };
  }, [loadVotes, shouldPollReceipts, shouldPollLegacyVotes]);

  function isReceiptExpanded(receipt, index) {
    if (expandedReceipts[receipt.key] === undefined) {
      return index === 0;
    }

    return expandedReceipts[receipt.key];
  }

  function toggleReceipt(receiptKey) {
    setExpandedReceipts((current) => ({
      ...current,
      [receiptKey]: !(
        current[receiptKey] ??
        receiptGroups.findIndex((receipt) => receipt.key === receiptKey) === 0
      ),
    }));
  }

  return (
    <div className="student-receipts-desktop">
      <header className="student-receipts-opening">
        <div className="student-receipts-opening-copy">
          <span className="student-receipts-kicker">Vote receipt</span>
          <h1>Your vote has been recorded.</h1>
          <p>
            Kandid is completing the security verification of your ballot
            receipt in the background. You may safely leave this page.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadVotes()}
          disabled={loading}
          className="student-receipts-refresh"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <div className="student-receipts-list">
        {loading ? (
          <StudentSkeletonGroup label="Loading receipts">
            <div className="student-receipts-register-head" role="presentation">
              <span>Your Receipts</span>
            </div>

            {[0, 1].map((index) => (
              <div className="student-receipt-paper" key={index}>
                <div className="student-skeleton-row">
                  <StudentSkeletonLine
                    variant="media"
                    width="2.4rem"
                    height="0.7rem"
                  />

                  <div className="student-skeleton-copy">
                    <StudentSkeletonLine width="56%" height="0.95rem" />
                    <StudentSkeletonLine width="38%" height="0.6rem" />
                  </div>

                  <StudentSkeletonLine width="5.5rem" height="0.6rem" />
                </div>
              </div>
            ))}
          </StudentSkeletonGroup>
        ) : loadError ? (
          <div className="student-receipts-state">
            <div className="space-y-3">
              <p className="font-bold text-rose-600">Unable to load receipts.</p>
              <p className="text-sm text-gray-500">{loadError}</p>
              <button type="button" onClick={() => loadVotes()} className="student-outline-btn">
                Retry
              </button>
            </div>
          </div>
        ) : receiptGroups.length === 0 ? (
          <div className="student-receipts-state">
            <p>No vote records found.</p>
          </div>
        ) : (
          <>
            <div className="student-receipts-register-head" role="presentation">
              <span>Your Receipts</span>
            </div>
            {receiptGroups.map((receipt, index) => (
              <section
                key={receipt.key}
                className={`student-receipt-paper fade-up ${isReceiptExpanded(receipt, index) ? "is-expanded" : ""}`}
                style={{ animationDelay: `${index * 35}ms` }}
              >
                <button
                  type="button"
                  className="student-receipt-toggle"
                  onClick={() => toggleReceipt(receipt.key)}
                  aria-expanded={isReceiptExpanded(receipt, index)}
                >
                  <span className="student-receipt-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong className="student-receipt-row-election">{receipt.electionTitle}</strong>
                  <span className="student-receipt-row-org">{receipt.organizationName}</span>
                  <time className="student-receipt-row-date">
                    {formatUtcTimestampAsManilaDate(receipt.submittedAt)}
                  </time>
                  <ChevronRight size={15} className="student-receipt-row-arrow" />
                </button>

              {isReceiptExpanded(receipt, index) ? (
                <>
                  <div className="student-receipt-document">
                    <div className="student-receipt-identity-lockup">
                      <OrganizationLogo
                        organization={{
                          name: receipt.organizationName,
                          description: receipt.organizationDescription,
                          logo_url: receipt.organizationLogoUrl,
                        }}
                        className="student-receipt-org-logo"
                      />
                      <p className="student-receipt-org-name">{receipt.organizationName}</p>
                    </div>
                    {receipt.organizationDescription &&
                    receipt.organizationDescription !== receipt.organizationName ? (
                      <p className="student-receipt-org-full">{receipt.organizationDescription}</p>
                    ) : null}
                    <p className="student-receipt-doc-label">Official Ballot Receipt</p>
                    <h2 className="student-receipt-election-title">{receipt.electionTitle}</h2>
                    <p className="student-receipt-tagline">Your ballot was successfully recorded.</p>
                  </div>
                  {isBallotV1Receipt(receipt) ? (
                    <>
                    {(() => {
                      const status = getReceiptBlockchainStatusMeta(receipt);
                      const ballotRecord = getReceiptBlockchainRecord(receipt);
                      const isVerified = status.className === "verified";

                      return (
                        <>
                          <div className="student-receipt-meta">
                            <div>
                              <span>Submitted</span>
                              <strong>{formatUtcTimestampAsManilaDateTime(receipt.submittedAt)}</strong>
                            </div>
                            <div>
                              <span>Selections</span>
                              <strong>{receipt.votes.length}</strong>
                            </div>
                            <div>
                              <span>Verification</span>
                              <strong className={isVerified ? "is-verified" : ""}>
                                {isVerified
                                  ? "Verified"
                                  : receipt.ballotVerificationUnavailable
                                    ? "Details unavailable"
                                    : "Verifying"}
                              </strong>
                            </div>
                          </div>

                          <div className="student-receipt-divider" />

                          <div className="student-ballot-layout">
                            <div className="student-ballot-sheet">
                              <div className="student-ballot-section-head">
                                <span>Your Ballot</span>
                                <strong>One complete submitted ballot</strong>
                              </div>

                              <div className="student-ballot-selection-list">
                                {receipt.votes.map((vote) => (
                                  <div key={vote.id} className="student-ballot-selection">
                                    <div className="student-ballot-selection-main">
                                      <span>{vote.is_abstain ? "Abstained" : "Recorded"}</span>
                                      <strong>{vote.positions?.name || "Position"}</strong>
                                    </div>
                                    <SelectionIntegrityHash value={vote.vote_hash || ""} />
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="student-ballot-status-card">
                              <BallotSealVisual status={status} />
                              <span>Ballot Status</span>
                              <strong className={`student-receipt-status ${status.className}`}>
                                <ShieldCheck size={15} />
                                {isVerified ? "Ballot verified" : status.label}
                              </strong>
                              <em>
                                {isVerified
                                  ? "Your ballot's integrity record has been secured on the blockchain."
                                  : status.detail}
                              </em>
                              <p className="student-ballot-hash-note">
                                Each selection has its own integrity hash. Kandid then seals your complete
                                ballot into one integrity record for blockchain verification.
                              </p>
                              <button
                                  type="button"
                                  className="student-receipt-tx-link student-receipt-secondary-action"
                                  onClick={() =>
                                    navigate(`/student/receipt/${receipt.votes[0].id}/verification`, {
                                      state: { vote: receipt.votes[0], receipt },
                                    })
                                  }
                                >
                                  <ExternalLink size={14} />
                                  View Verification
                                </button>
                            </div>
                          </div>

                          <div className="student-receipt-divider" />

                          <div className={`student-receipt-verification ${isVerified ? "is-complete" : ""}`}>
                            <div>
                              <span>Vote</span>
                              <strong>Got it. Your vote is recorded.</strong>
                              <em>Wait, you can count on me.</em>
                            </div>
                            <div>
                              <span>Blockchain</span>
                              <strong>{isVerified ? "Permanent integrity record secured." : "Integrity verification may still be processing."}</strong>
                              <em>You do not need to wait here.</em>
                            </div>
                            <BallotProgress status={status} />
                          </div>

                          {ballotRecord?.ballot_hash ? (
                            <details className="receipt-detail-technical">
                              <summary>Technical Details</summary>
                              <div className="receipt-detail-tech-grid">
                                <div className="receipt-detail-tech-row">
                                  <span>Ballot Hash</span>
                                  <div>
                                    <code>{ballotRecord.ballot_hash}</code>
                                  </div>
                                </div>
                              </div>
                            </details>
                          ) : null}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                  <div className="student-receipt-meta">
                    <div>
                      <span>Election ID</span>
                      <strong>{receipt.key}</strong>
                    </div>
                    <div>
                      <span>Submitted On</span>
                      <strong>{formatUtcTimestampAsManilaDateTime(receipt.submittedAt)}</strong>
                    </div>
                    <div>
                      <span>Receipt Rows</span>
                      <strong>{receipt.votes.length}</strong>
                    </div>
                  </div>

                  <div className="student-receipt-divider" />

                  <div className="student-receipt-grid" role="table" aria-label="Vote receipt rows">
                    <div className="student-receipt-grid-head" role="row">
                      <span role="columnheader">Position</span>
                      <span role="columnheader">Vote Hash</span>
                      <span role="columnheader">Receipt Security</span>
                    </div>

                    {receipt.votes.map((vote) => (
                      <div key={vote.id} className="student-receipt-row" role="row">
                        {(() => {
                          const status = getBlockchainStatusMeta(vote);
                          const detail = getVoteBlockchainDetail(vote);

                          return (
                            <>
                              <div role="cell">
                                <span>Position</span>
                                <strong>{vote.positions?.name || "-"}</strong>
                                {vote.is_abstain ? <em>Abstained</em> : <em>Candidate vote</em>}
                                <div className="student-receipt-recorded">
                                  <ShieldCheck size={14} />
                                  Recorded
                                </div>
                              </div>

                              <div role="cell">
                                <span>Vote Hash</span>
                                <code>{vote.vote_hash || "Pending hash"}</code>
                              </div>

                              <div role="cell">
                                <span>Receipt Security</span>
                                <BlockchainVerificationMachine status={status} />
                                <div className="student-receipt-status-stack">
                                  <strong className={`student-receipt-status ${status.className}`}>
                                    <ShieldCheck size={15} />
                                    {status.label}
                                  </strong>
                                  {vote.blockchain_tx_id ? (
                                    <button
                                      type="button"
                                      className="student-receipt-tx-link"
                                      onClick={() =>
                                        navigate(`/student/receipt/${vote.id}/verification`, {
                                          state: { vote, receipt },
                                        })
                                      }
                                    >
                                      <ExternalLink size={14} />
                                      View Verification
                                    </button>
                                  ) : null}
                                </div>
                                <em>{detail || status.detail}</em>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  <div className="student-receipt-divider" />

                  {(() => {
                    const { anchored, total } = getVerificationCounts(receipt.votes);

                    return (
                      <div
                        className={`student-receipt-verification ${anchored === total ? "is-complete" : ""}`}
                      >
                        <div>
                          <span>Ballot Status</span>
                          <strong>Your entire ballot has been successfully submitted.</strong>
                          <em>You may safely leave this page.</em>
                        </div>
                        <div>
                          <span>Security Verification</span>
                          <strong>{getVerificationSummary(receipt.votes)}</strong>
                          {anchored < total ? (
                            <em>Verification continues automatically.</em>
                          ) : (
                            <em>Security verification complete.</em>
                          )}
                        </div>
                        <div
                          className="student-receipt-verification-progress"
                          aria-label={`${anchored} of ${total} receipt records verified on Sepolia`}
                        >
                          {receipt.votes.map((vote) => {
                            const rowStatus = getNormalizedBlockchainStatus(vote);

                            return (
                              <span
                                key={vote.id}
                                className={
                                  rowStatus === "anchored"
                                    ? "is-verified"
                                    : shouldPollBlockchainStatus(vote)
                                      ? "is-processing"
                                      : "is-waiting"
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </>
                )}
              </>
            ) : null}
            </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default StudentReceipt;
