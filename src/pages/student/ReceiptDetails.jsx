import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Fingerprint,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import {
  getBlockchainExplorerAddressUrl,
  getBlockchainExplorerTxUrl,
} from "../../utils/blockchain";
import {
  formatAbsoluteTimestampAsManilaDateTime,
  formatUtcTimestampAsManilaDateTime,
} from "../../utils/time";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import {
  fetchStudentVotes,
  getBlockchainStatusMeta,
  getReceiptBlockchainRecord,
  getReceiptBlockchainStatusMeta,
  groupReceiptVotes,
  isBallotV1Receipt,
  normalizeReceiptVotes,
} from "./receiptData";

function shortenIdentifier(value) {
  if (!value) return "-";
  if (value.length <= 18) return value;

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function formatNetworkName(value) {
  if (!value) return "";

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TechnicalValue({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    if (!value || !navigator.clipboard) return;

    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="receipt-detail-tech-row">
      <span>{label}</span>
      <div>
        <code title={value || "-"}>{shortenIdentifier(value)}</code>
        {value ? (
          <button type="button" onClick={copyValue} className="receipt-detail-copy">
            <Copy size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="receipt-detail-info-section">
      <h2>{title}</h2>
      <div className="receipt-detail-tech-grid">
        {children}
      </div>
    </section>
  );
}

function StoryStep({ icon: Icon, title, status, children }) {
  return (
    <article className="receipt-detail-story-step">
      <div className="receipt-detail-story-icon" aria-hidden="true">
        <Icon size={20} />
      </div>
      <div>
        <span>{title}</span>
        <strong>{status}</strong>
        <p>{children}</p>
      </div>
    </article>
  );
}

function VerificationCard({ icon: Icon, title, value, isCurrent }) {
  return (
    <div className={`receipt-detail-chain-block ${isCurrent ? "is-current" : ""}`}>
      <Icon size={22} aria-hidden="true" />
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReceiptDetails() {
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
      console.error("Failed to load receipt details:", error);
      setLoadError(error.message || "Unable to load receipt details.");
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
  const currentReceipt = receiptGroups.find((receipt) =>
    receipt.votes.some((vote) => String(vote.id) === String(voteId))
  ) || routeReceipt || (currentVote
    ? {
      key: currentVote.ballot_id || currentVote.election_id || currentVote.id,
      electionTitle: currentVote.elections?.title || "Election",
      organizationName: currentVote.elections?.organizations?.name || "Organization",
      submittedAt: currentVote.vote_timestamp,
      ballot: currentVote.ballot || null,
      votes: [currentVote],
    }
    : null);
  const isBallotV1 = isBallotV1Receipt(currentReceipt);
  const blockchainRecord = isBallotV1 ? getReceiptBlockchainRecord(currentReceipt) : currentVote;
  const status = isBallotV1
    ? getReceiptBlockchainStatusMeta(currentReceipt)
    : blockchainRecord
      ? getBlockchainStatusMeta(blockchainRecord)
      : null;
  const hasSepoliaRecord = blockchainRecord?.blockchain_network === "sepolia";
  const explorerUrl = hasSepoliaRecord && blockchainRecord?.blockchain_tx_id
    ? getBlockchainExplorerTxUrl(blockchainRecord.blockchain_tx_id)
    : "";
  const contractUrl = hasSepoliaRecord && blockchainRecord?.blockchain_contract_address
    ? getBlockchainExplorerAddressUrl(blockchainRecord.blockchain_contract_address)
    : "";
  const blockNumber = blockchainRecord?.blockchain_block_number
    ? String(blockchainRecord.blockchain_block_number)
    : "";
  const timestamp = blockchainRecord?.blockchain_anchored_at
    ? formatAbsoluteTimestampAsManilaDateTime(blockchainRecord.blockchain_anchored_at)
    : !isBallotV1 && currentVote?.vote_timestamp
      ? formatUtcTimestampAsManilaDateTime(currentVote.vote_timestamp)
      : "";

  function goBack() {
    navigate("/student/receipt");
  }

  if (loading && !currentVote) {
    return (
      <StudentSkeletonGroup
        label="Loading receipt details"
        className="receipt-detail-skeleton"
      >
        <div className="page-head">
          <div className="student-skeleton-stack">
            <StudentSkeletonLine width="34%" height="0.6rem" />
            <StudentSkeletonLine width="56%" height="1.5rem" />
            <StudentSkeletonLine width="88%" height="0.7rem" />
            <StudentSkeletonLine width="72%" height="0.7rem" />
          </div>
        </div>

        <section className="student-receipt-paper receipt-detail-panel">
          <div className="student-skeleton-row">
            <StudentSkeletonLine variant="media" width="3.25rem" height="3.25rem" />

            <div className="student-skeleton-copy">
              <StudentSkeletonLine width="48%" height="0.7rem" />
              <StudentSkeletonLine width="66%" height="1rem" />
              <StudentSkeletonLine width="38%" height="0.6rem" />
            </div>
          </div>

          <div className="student-skeleton-stack">
            <StudentSkeletonLine width="100%" height="0.6rem" />
            <StudentSkeletonLine width="94%" height="0.6rem" />
            <StudentSkeletonLine width="76%" height="0.6rem" />
          </div>
        </section>
      </StudentSkeletonGroup>
    );
  }

  if (loadError && !currentVote) {
    return (
      <div className="glass-panel rounded-[28px] p-8">
        <p className="font-bold text-rose-600">Unable to load receipt details.</p>
        <p className="mt-2 text-sm text-gray-500">{loadError}</p>
        <button type="button" onClick={loadVotes} className="secondary-btn mt-4">
          Retry
        </button>
      </div>
    );
  }

  if (!currentVote || !status || !currentReceipt) {
    return <div className="glass-panel rounded-[28px] p-8 text-gray-500">Receipt record not found.</div>;
  }

  return (
    <div className="receipt-detail-page">
      <div className="page-head">
        <div>
          <div className="student-receipt-success-seal" aria-hidden="true">
            <ReceiptText size={22} />
          </div>
          <div className="page-kicker">{isBallotV1 ? "Ballot Verification" : "Receipt Verification"}</div>
          <h1 className="page-title">
            {isBallotV1 ? "Ballot" : "Receipt"}
            <span className="page-title-accent"> Verification.</span>
          </h1>
          <p className="page-subtitle">
            Your vote is already recorded in Kandid. This page shows the blockchain
            verification information connected to your digital receipt. Your actual
            candidate choices are not displayed publicly.
          </p>
        </div>

        <button type="button" onClick={goBack} className="secondary-btn self-start lg:self-auto">
          <ArrowLeft size={18} />
          Receipt
        </button>
      </div>

      <section className="student-receipt-paper receipt-detail-panel">
        <div className="receipt-detail-document-label">
          <span>KANDID</span>
          <strong>{isBallotV1 ? "Ballot Verification" : "Receipt Verification"}</strong>
          {isBallotV1 ? <em>One ballot. One record. One proof.</em> : null}
        </div>

        <div className="receipt-detail-story-head">
          <h2>{isBallotV1 ? "One complete ballot, one verification record" : "Historical receipt verification"}</h2>
          <p>
            {isBallotV1
              ? "Each selection has its own integrity hash. Kandid then seals your complete ballot into one integrity record for blockchain verification."
              : "This older receipt uses the previous vote-row verification format. Your vote remains recorded in Kandid."}
          </p>
        </div>

        <div className="receipt-detail-story-flow">
          {isBallotV1 ? (
            <>
              <StoryStep icon={CheckCircle2} title="Complete Ballot" status="Recorded in Kandid">
                Your ballot has already been saved successfully.
              </StoryStep>
              <StoryStep icon={Fingerprint} title="Integrity Seal" status="Ballot fingerprint created">
                Kandid creates one proof for the complete ballot, not separate public records for each selection.
              </StoryStep>
              <StoryStep icon={ReceiptText} title="Blockchain Record" status={status.label}>
                {status.detail}
              </StoryStep>
            </>
          ) : (
            <>
              <StoryStep icon={CheckCircle2} title="Vote" status="Recorded in Kandid">
                Your vote has already been saved successfully.
              </StoryStep>
              <StoryStep icon={Fingerprint} title="Receipt Hash" status="Integrity hash created">
                This historical receipt keeps its original vote-row verification data.
              </StoryStep>
              <StoryStep icon={ReceiptText} title="Verification" status={status.label}>
                {status.detail}
              </StoryStep>
            </>
          )}
        </div>

        <div className="student-receipt-divider" />

        <div className="receipt-detail-status">
          <div>
            <span>Status</span>
            <strong className={`student-receipt-status ${status.className}`}>
              <ShieldCheck size={15} />
              {status.label}
            </strong>
            <em>
              {status.detail}
            </em>
          </div>
          <div className={`student-ballot-seal ${status.className}`} aria-hidden="true">
            <div className="student-ballot-seal-paper">
              <span />
              <span />
              <span />
            </div>
            <div className="student-ballot-seal-stamp">
              <ShieldCheck size={24} />
            </div>
            <strong>{status.className === "verified" ? "Verified" : "Recorded"}</strong>
          </div>
        </div>

        <div className="student-receipt-divider" />

        {isBallotV1 ? (
          <div className="receipt-detail-blockchain-visual" aria-label="Ballot verification visual">
            <div className="receipt-detail-chain">
              <VerificationCard icon={ReceiptText} title="Complete Ballot" value="Saved in Kandid" />
              <VerificationCard icon={Fingerprint} title="Integrity Seal" value="One ballot hash" isCurrent />
              <VerificationCard icon={ShieldCheck} title="Blockchain Record" value={status.className === "verified" ? "Verified" : status.label} />
            </div>
          </div>
        ) : null}

        <div className="receipt-detail-meaning">
          <h2>What does this mean?</h2>
          <p>
            {isBallotV1
              ? "Kandid anchors the ballot's integrity proof to the blockchain. The transaction does not contain your candidate selections."
              : "This receipt shows the verification information that was stored for this historical vote record."}
          </p>
        </div>

        <div className="receipt-detail-privacy-card">
          <LockKeyhole size={22} aria-hidden="true" />
          <div>
            <h2>Your choices remain private</h2>
            <p>
              The blockchain stores the ballot&apos;s integrity proof, not your actual
              candidate selections.
            </p>
          </div>
        </div>

        <div className="student-receipt-divider" />

        <details className="receipt-detail-technical">
          <summary>Technical Details</summary>
          <div className="receipt-detail-technical-body">
            {isBallotV1 ? (
              <DetailSection title="Ballot Integrity">
                <TechnicalValue label="Ballot ID" value={blockchainRecord?.ballot_id || blockchainRecord?.id || ""} />
                <TechnicalValue label="Ballot Hash" value={blockchainRecord?.ballot_hash || ""} />
                <TechnicalValue label="Hash Version" value={blockchainRecord?.hash_version || ""} />
              </DetailSection>
            ) : (
              <DetailSection title="Historical Integrity">
                <TechnicalValue label="Selection Integrity Hash" value={currentVote.vote_hash || ""} />
                <TechnicalValue label="Hash Version" value={currentVote.hash_version || ""} />
              </DetailSection>
            )}
            {isBallotV1 ? (
              <DetailSection title="Selection Integrity Hashes">
                {currentReceipt.votes.map((vote) => (
                  <TechnicalValue
                    key={vote.id}
                    label={`${vote.positions?.name || "Selection"} SHA-256 Integrity Hash`}
                    value={vote.vote_hash || ""}
                  />
                ))}
              </DetailSection>
            ) : null}
            <DetailSection title="Blockchain Verification">
              <TechnicalValue label="Network" value={formatNetworkName(blockchainRecord?.blockchain_network || "")} />
              <TechnicalValue label="Transaction Hash" value={blockchainRecord?.blockchain_tx_id || ""} />
              <TechnicalValue label="Block" value={blockNumber} />
              <TechnicalValue label="Verified At" value={timestamp} />
              <TechnicalValue label="Contract Address" value={blockchainRecord?.blockchain_contract_address || ""} />
            </DetailSection>
          </div>
        </details>

        {explorerUrl ? (
          <div className="receipt-detail-etherscan">
            <h2>Want to verify the technical record?</h2>
            <p>
              Etherscan is an independent blockchain explorer where you can view the
              actual transaction record.
            </p>
            <a
              className="secondary-btn mt-4 w-full justify-center sm:w-auto"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={18} />
              View Verification
            </a>
            {contractUrl ? (
              <a
                className="secondary-btn mt-4 w-full justify-center sm:w-auto"
                href={contractUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={18} />
                View Contract
              </a>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default ReceiptDetails;
