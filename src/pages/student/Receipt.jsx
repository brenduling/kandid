import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Copy, ExternalLink, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { KandidInlineLoader } from "../../components/KandidLoader";
import { getBlockchainExplorerTxUrl } from "../../utils/blockchain";
import { formatUtcTimestampAsManilaDateTime } from "../../utils/time";
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
    "Complete Ballot",
    "Ballot Sealed",
    "Integrity Record",
    "Blockchain",
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
    <div>
      <div className="page-head">
        <div>
          <div className="student-receipt-success-seal" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div className="page-kicker">Vote Receipt</div>
          <h1 className="page-title">
            Your vote has
            <span className="page-title-accent"> been recorded.</span>
          </h1>
          <p className="page-subtitle">
            Your ballot has been successfully submitted to Kandid. Kandid is completing
            the security verification of your receipt in the background. You may safely
            leave this page.
          </p>
        </div>

        <button
          onClick={() => loadVotes()}
          disabled={loading}
          className="primary-btn self-start lg:self-auto"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-8 space-y-6">
        {loading ? (
          <div className="glass-panel rounded-[28px] p-8">
            <KandidInlineLoader message="Loading receipts..." />
          </div>
        ) : loadError ? (
          <div className="glass-panel rounded-[28px] p-8">
            <div className="space-y-3">
              <p className="font-bold text-rose-600">Unable to load receipts.</p>
              <p className="text-sm text-gray-500">{loadError}</p>
              <button type="button" onClick={() => loadVotes()} className="secondary-btn">
                Retry
              </button>
            </div>
          </div>
        ) : receiptGroups.length === 0 ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            No vote records found.
          </div>
        ) : (
          receiptGroups.map((receipt, index) => (
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
                <div className="student-receipt-toggle-main">
                  <div className="student-receipt-mark">
                    <ReceiptText size={22} />
                  </div>
                  <div>
                    <span>KANDID Receipt</span>
                    <strong>{receipt.electionTitle}</strong>
                    <em>{receipt.organizationName}</em>
                  </div>
                </div>
                <ChevronDown size={20} />
              </button>

              {isReceiptExpanded(receipt, index) ? (
                isBallotV1Receipt(receipt) ? (
                  <>
                    {(() => {
                      const status = getReceiptBlockchainStatusMeta(receipt);
                      const ballotRecord = getReceiptBlockchainRecord(receipt);
                      const isVerified = status.className === "verified";
                      const hasSepoliaTx =
                        ballotRecord?.blockchain_network === "sepolia" &&
                        Boolean(ballotRecord?.blockchain_tx_id);
                      const explorerUrl = hasSepoliaTx
                        ? getBlockchainExplorerTxUrl(ballotRecord.blockchain_tx_id)
                        : "";

                      return (
                        <>
                          <div className="student-receipt-divider" />

                          <div className="student-receipt-brand">
                            <p>KANDID</p>
                            <div className="student-receipt-title">
                              <p>Official Ballot Receipt</p>
                              <h2>{receipt.electionTitle}</h2>
                              <em>One ballot. One record. One proof.</em>
                            </div>
                          </div>

                          <div className="student-receipt-meta">
                            <div>
                              <span>Submitted On</span>
                              <strong>{formatUtcTimestampAsManilaDateTime(receipt.submittedAt)}</strong>
                            </div>
                            <div>
                              <span>Selections</span>
                              <strong>{receipt.votes.length}</strong>
                            </div>
                            <div>
                              <span>Ballot Seal</span>
                              <strong>
                                {ballotRecord?.ballot_hash
                                  ? "Integrity record created"
                                  : receipt.ballotVerificationUnavailable
                                    ? "Verification details unavailable"
                                    : "Preparing integrity record"}
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
                                      <span>{vote.positions?.name || "Position"}</span>
                                      <strong>{vote.is_abstain ? "Abstained" : "Candidate vote recorded"}</strong>
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
                                {status.label}
                              </strong>
                              <em>{status.detail}</em>
                              <p className="student-ballot-hash-note">
                                Each selection has its own integrity hash. Kandid then seals your complete
                                ballot into one integrity record for blockchain verification.
                              </p>
                              {explorerUrl ? (
                                <a
                                  className="student-receipt-tx-link student-receipt-secondary-action"
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink size={14} />
                                  View Verification
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  className="student-receipt-tx-link student-receipt-secondary-action"
                                  disabled={status.className !== "verified" && !receipt.ballotVerificationUnavailable}
                                  onClick={() =>
                                    navigate(`/student/receipt/${receipt.votes[0].id}`, {
                                      state: { vote: receipt.votes[0], receipt },
                                    })
                                  }
                                >
                                  <ExternalLink size={14} />
                                  View Details
                                </button>
                              )}
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
                  <div className="student-receipt-divider" />

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
                                        navigate(`/student/receipt/${vote.id}`, {
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
                )
              ) : null}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default StudentReceipt;
