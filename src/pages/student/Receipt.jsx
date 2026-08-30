import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getBlockchainExplorerTxUrl } from "../../utils/blockchain";
import { KandidInlineLoader } from "../../components/KandidLoader";
import {
  isMissingPositionOrderError,
  sortVotesByPositionOrder,
} from "../../utils/positionOrder";
import { formatLocalDateTime, parseAbsoluteTimestamp } from "../../utils/time";

function getReceiptGroupKey(vote) {
  return vote.election_id || vote.elections?.title || vote.id;
}

function getBlockchainStatus(vote) {
  if (vote.blockchain_tx_id) return "Verified";
  return "Pending";
}

async function fetchStudentVotes(studentId, includeDisplayOrder = true) {
  const positionColumns = includeDisplayOrder
    ? "id, name, display_order"
    : "id, name";

  return supabase
    .from("votes")
    .select(`
      *,
      elections (
        title,
        organizations (
          name
        )
      ),
      positions (
        ${positionColumns}
      )
    `)
    .eq("student_id", studentId)
    .order("vote_timestamp", { ascending: false });
}

function StudentReceipt() {
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedReceipts, setExpandedReceipts] = useState({});
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadVotes() {
      setLoading(true);
      setLoadError("");

      let { data, error } = await fetchStudentVotes(user.id);

      if (isMissingPositionOrderError(error)) {
        const fallback = await fetchStudentVotes(user.id, false);
        data = (fallback.data || []).map((vote) => ({
          ...vote,
          positions: {
            ...vote.positions,
            display_order: vote.position_id,
          },
        }));
        error = fallback.error;
      }

      if (!active) return;

      if (error) {
        console.error("Failed to load student receipts:", error);
        setLoadError(error.message || "Unable to load vote receipts.");
        setVotes([]);
        setLoading(false);
        return;
      }

      setVotes(data || []);
      setLoading(false);
    }

    loadVotes();

    return () => {
      active = false;
    };
  }, [user.id]);

  async function fetchVotes() {
    setLoading(true);
    setLoadError("");

    let { data, error } = await fetchStudentVotes(user.id);

    if (isMissingPositionOrderError(error)) {
      const fallback = await fetchStudentVotes(user.id, false);
      data = (fallback.data || []).map((vote) => ({
        ...vote,
        positions: {
          ...vote.positions,
          display_order: vote.position_id,
        },
      }));
      error = fallback.error;
    }

    if (error) {
      console.error("Failed to refresh student receipts:", error);
      setLoadError(error.message || "Unable to load vote receipts.");
      setVotes([]);
      setLoading(false);
      return;
    }

    setVotes(data || []);
    setLoading(false);
  }

  const receiptGroups = useMemo(() => {
    const groups = new Map();

    votes.forEach((vote) => {
      const key = getReceiptGroupKey(vote);
      const current = groups.get(key) || {
        key,
        organizationName: vote.elections?.organizations?.name || "Organization",
        electionTitle: vote.elections?.title || "Election",
        submittedAt: vote.vote_timestamp,
        votes: [],
      };

      current.votes.push(vote);

      if (
        vote.vote_timestamp &&
        (!current.submittedAt ||
          parseAbsoluteTimestamp(vote.vote_timestamp) >
            parseAbsoluteTimestamp(current.submittedAt))
      ) {
        current.submittedAt = vote.vote_timestamp;
      }

      groups.set(key, current);
    });

    return [...groups.values()].map((group) => ({
      ...group,
      votes: sortVotesByPositionOrder(group.votes),
    }));
  }, [votes]);

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
          <div className="page-kicker">Vote Receipt</div>
          <h1 className="page-title">
            Your submitted
            <span className="page-title-accent"> ballot records</span>
          </h1>
          <p className="page-subtitle">
            View your submitted vote records and verification hashes.
          </p>
        </div>

        <button
          onClick={fetchVotes}
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
              <button type="button" onClick={fetchVotes} className="secondary-btn">
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
                <>
                  <div className="student-receipt-divider" />

                  <div className="student-receipt-meta">
                    <div>
                      <span>Election ID</span>
                      <strong>{receipt.key}</strong>
                    </div>
                    <div>
                      <span>Submitted On</span>
                      <strong>{formatLocalDateTime(receipt.submittedAt)}</strong>
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
                      <span role="columnheader">Blockchain Status</span>
                    </div>

                    {receipt.votes.map((vote) => (
                      <div key={vote.id} className="student-receipt-row" role="row">
                        <div role="cell">
                          <span>Position</span>
                          <strong>{vote.positions?.name || "-"}</strong>
                          {vote.is_abstain ? <em>Abstained</em> : <em>Submitted</em>}
                        </div>

                        <div role="cell">
                          <span>Vote Hash</span>
                          <code>{vote.vote_hash || "Pending hash"}</code>
                        </div>

                        <div role="cell">
                          <span>Blockchain Status</span>
                          <strong
                            className={
                              vote.blockchain_tx_id
                                ? "student-receipt-status verified"
                                : "student-receipt-status pending"
                            }
                          >
                            <ShieldCheck size={15} />
                            {getBlockchainStatus(vote)}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="student-receipt-divider" />

                  <div className="student-receipt-verification">
                    <div>
                      <span>Overall Verification</span>
                      <strong>
                        {receipt.votes.every((vote) => vote.blockchain_tx_id)
                          ? "All rows recorded on Sepolia"
                          : "Some rows are pending on-chain record"}
                      </strong>
                    </div>

                    {receipt.votes
                      .filter((vote) => vote.blockchain_tx_id)
                      .map((vote) => (
                        <a
                          key={vote.id}
                          href={getBlockchainExplorerTxUrl(vote.blockchain_tx_id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={15} />
                          View transaction for {vote.positions?.name || "position"}
                        </a>
                      ))}
                  </div>
                </>
              ) : null}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default StudentReceipt;
