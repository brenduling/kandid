import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function StudentReceipt() {
  const [votes, setVotes] = useState([]);
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    fetchVotes();
  }, []);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">My Votes</h1>
          <p className="text-gray-500 mt-1">
            View your submitted vote records and verification hashes.
          </p>
        </div>

        <button
          onClick={fetchVotes}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-8 space-y-4">
        {votes.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            No vote records found.
          </div>
        ) : (
          votes.map((vote) => (
            <div
              key={vote.id}
              className="bg-white p-6 rounded-2xl shadow-sm border"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-[#ff5a1f]">
                    {vote.elections?.organizations?.name || "Organization"}
                  </p>

                  <h2 className="text-xl font-black mt-1">
                    {vote.elections?.title}
                  </h2>

                  <p className="text-sm text-gray-500 mt-1">
                    Position: {vote.positions?.name || "-"}
                  </p>

                  <p className="text-sm text-gray-500">
                    Submitted:{" "}
                    {vote.vote_timestamp
                      ? new Date(vote.vote_timestamp).toLocaleString()
                      : "-"}
                  </p>
                </div>

                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    vote.is_abstain
                      ? "bg-gray-100 text-gray-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {vote.is_abstain ? "Abstained" : "Submitted"}
                </span>
              </div>

              <div className="mt-5 bg-gray-50 rounded-xl p-4">
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
                  <span className="font-bold text-green-600">Recorded</span>
                ) : (
                  <span className="font-bold text-orange-600">Pending</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default StudentReceipt;