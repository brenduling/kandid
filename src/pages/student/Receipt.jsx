import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getBlockchainExplorerTxUrl } from "../../utils/blockchain";

function StudentReceipt() {
  const [votes, setVotes] = useState([]);
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadVotes() {
      const { data, error } = await supabase
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
            name
          )
        `)
        .eq("student_id", user.id)
        .order("vote_timestamp", { ascending: false });

      if (!active) return;

      if (!error) setVotes(data || []);
      if (error) console.log(error);
    }

    loadVotes();

    return () => {
      active = false;
    };
  }, [user.id]);

  async function fetchVotes() {
    const { data, error } = await supabase
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
          name
        )
      `)
      .eq("student_id", user.id)
      .order("vote_timestamp", { ascending: false });

    if (!error) setVotes(data || []);
    if (error) console.log(error);
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

      <div className="mt-8 space-y-4">
        {votes.length === 0 ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            No vote records found.
          </div>
        ) : (
          votes.map((vote, index) => (
            <div
              key={vote.id}
              className="glass-panel-strong fade-up rounded-[28px] border p-6"
              style={{ animationDelay: `${index * 35}ms` }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d35a25]">
                    {vote.elections?.organizations?.name || "Organization"}
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    {vote.elections?.title}
                  </h2>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-white/40 p-4">
                      <p className="field-label !mb-1">Position</p>
                      <p className="text-sm font-semibold text-[#1d262f]">
                        {vote.positions?.name || "-"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/40 p-4">
                      <p className="field-label !mb-1">Submitted On</p>
                      <p className="text-sm font-semibold text-[#1d262f]">
                        {vote.vote_timestamp
                          ? new Date(vote.vote_timestamp).toLocaleString()
                          : "-"}
                      </p>
                    </div>
                  </div>
                </div>

                <span
                  className={`status-pill ${
                    vote.is_abstain
                      ? "!bg-[rgba(29,38,47,0.08)] !text-gray-700"
                      : "!bg-[rgba(54,147,111,0.12)] !text-green-700"
                  }`}
                >
                  {vote.is_abstain ? "Abstained" : "Submitted"}
                </span>
              </div>

              <div className="mt-5 rounded-2xl bg-white/50 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                  <ShieldCheck size={16} className="text-green-600" />
                  Verification Hash
                </div>

                <p className="mt-2 text-xs font-mono text-gray-600 break-all">
                  {vote.vote_hash || "Pending hash"}
                </p>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Blockchain Status:{" "}
                {vote.blockchain_tx_id ? (
                  <span className="font-bold text-green-600">Recorded on Sepolia</span>
                ) : (
                  <span className="font-bold text-orange-600">Pending on-chain record</span>
                )}
              </div>

              {vote.blockchain_tx_id ? (
                <a
                  href={getBlockchainExplorerTxUrl(vote.blockchain_tx_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#11806a] hover:underline"
                >
                  <ExternalLink size={15} />
                  View Sepolia transaction
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default StudentReceipt;
