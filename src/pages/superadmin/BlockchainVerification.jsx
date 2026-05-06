import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BlockchainVerification() {
  const [votes, setVotes] = useState([]);

  useEffect(() => {
    fetchVotes();
  }, []);

  async function fetchVotes() {
    const { data, error } = await supabase
      .from("votes")
      .select(`
        *,
        students (
          student_number,
          first_name,
          last_name
        ),
        elections (
          title
        ),
        positions (
          name
        )
      `)
      .order("id", { ascending: false });

    if (!error) setVotes(data || []);
    if (error) console.log(error);
  }

  const verified = votes.filter((v) => v.blockchain_tx_id).length;
  const pending = votes.filter((v) => !v.blockchain_tx_id && v.vote_hash).length;
  const missingHash = votes.filter((v) => !v.vote_hash).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Blockchain Verification</h1>
          <p className="text-gray-500 mt-1">
            Verify vote hashes and blockchain transaction records.
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

      <div className="grid grid-cols-3 gap-6 mt-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between">
            <p className="text-sm text-gray-500">Verified Records</p>
            <ShieldCheck className="text-green-600" />
          </div>
          <h2 className="text-3xl font-black mt-2">{verified}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between">
            <p className="text-sm text-gray-500">Pending Blockchain TX</p>
            <Clock className="text-orange-600" />
          </div>
          <h2 className="text-3xl font-black mt-2">{pending}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between">
            <p className="text-sm text-gray-500">Missing Hash</p>
            <AlertTriangle className="text-red-600" />
          </div>
          <h2 className="text-3xl font-black mt-2">{missingHash}</h2>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Voter</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Position</th>
              <th className="px-6 py-4 text-sm">Vote Hash</th>
              <th className="px-6 py-4 text-sm">Transaction ID</th>
              <th className="px-6 py-4 text-sm">Status</th>
            </tr>
          </thead>

          <tbody>
            {votes.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No vote records found.
                </td>
              </tr>
            ) : (
              votes.map((vote) => {
                const status = vote.blockchain_tx_id
                  ? "Verified"
                  : vote.vote_hash
                  ? "Pending"
                  : "Missing Hash";

                return (
                  <tr key={vote.id} className="border-b last:border-b-0">
                    <td className="px-6 py-4">
                      <p className="font-bold">
                        {vote.students?.first_name} {vote.students?.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {vote.students?.student_number}
                      </p>
                    </td>

                    <td className="px-6 py-4">{vote.elections?.title || "-"}</td>
                    <td className="px-6 py-4">{vote.positions?.name || "-"}</td>

                    <td className="px-6 py-4 text-xs font-mono max-w-[220px] truncate">
                      {vote.vote_hash || "-"}
                    </td>

                    <td className="px-6 py-4 text-xs font-mono max-w-[220px] truncate">
                      {vote.blockchain_tx_id || "-"}
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          status === "Verified"
                            ? "bg-green-100 text-green-700"
                            : status === "Pending"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BlockchainVerification;