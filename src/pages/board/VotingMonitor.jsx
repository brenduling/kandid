import { useEffect, useState } from "react";
import { RefreshCw, Vote, Users, CheckCircle, Clock } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime } from "../../utils/time";

function BoardVotingMonitor() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("all");

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchData();
  }, [orgId]);

  async function fetchData() {
    if (!orgId) return;

    const { data: orgElections } = await supabase
      .from("elections")
      .select("id, title")
      .eq("organization_id", orgId);

    const electionIds = orgElections?.map((e) => e.id) || [];

    setElections(orgElections || []);

    if (electionIds.length === 0) {
      setVotes([]);
      return;
    }

    const { data: voteData, error } = await supabase
      .from("votes")
      .select(`
        id,
        election_id,
        position_id,
        candidate_id,
        student_id,
        is_abstain,
        vote_timestamp,
        blockchain_tx_id,
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
        ),
        candidates (
          students (
            first_name,
            last_name
          )
        )
      `)
      .in("election_id", electionIds)
      .order("vote_timestamp", { ascending: false });

    if (!error) setVotes(voteData || []);
    if (error) console.log(error);
  }

  const filteredVotes =
    selectedElection === "all"
      ? votes
      : votes.filter((vote) => vote.election_id === Number(selectedElection));

  const uniqueVoters = new Set(filteredVotes.map((vote) => vote.student_id));

  const totalVotes = filteredVotes.length;
  const totalVoters = uniqueVoters.size;
  const abstainVotes = filteredVotes.filter((vote) => vote.is_abstain).length;
  const candidateVotes = filteredVotes.filter((vote) => !vote.is_abstain).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Live Vote Activity</div>
          <h1 className="page-title">Board voting monitor</h1>
          <p className="page-subtitle">
            Monitor vote activity for your assigned organization.
          </p>
        </div>

        <button onClick={fetchData} className="primary-btn self-start lg:self-auto">
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-8">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="field-shell bg-white px-4 py-3 outline-none"
        >
          <option value="all">All Elections</option>
          {elections.map((election) => (
            <option key={election.id} value={election.id}>
              {election.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Total Votes</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Vote size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{totalVotes}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Unique Voters</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Users size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{totalVoters}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Candidate Votes</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <CheckCircle size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{candidateVotes}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Abstain Votes</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Clock size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{abstainVotes}</h2>
        </div>
      </div>

      <div className="table-shell mt-8">
        <div className="overflow-x-auto">
          <table className="app-table">
            <thead>
              <tr>
                <th>Voter</th>
                <th>Election</th>
                <th>Position</th>
                <th>Vote Type</th>
                <th>Time</th>
                <th>Blockchain</th>
              </tr>
            </thead>

            <tbody>
            {filteredVotes.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center empty-copy">
                  No votes recorded yet.
                </td>
              </tr>
            ) : (
              filteredVotes.map((vote) => (
                <tr key={vote.id}>
                  <td>
                    <p className="font-bold">
                      {vote.students?.first_name} {vote.students?.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {vote.students?.student_number}
                    </p>
                  </td>

                  <td>
                    {vote.elections?.title || "-"}
                  </td>

                  <td>
                    {vote.positions?.name || "-"}
                  </td>

                  <td>
                    {vote.is_abstain ? (
                      <span className="status-pill !bg-slate-100 !text-slate-700">
                        Abstain
                      </span>
                    ) : (
                      <span className="status-pill !bg-emerald-100 !text-emerald-700">
                        Candidate Vote
                      </span>
                    )}
                  </td>

                  <td className="text-sm text-gray-600">
                    {formatLocalDateTime(vote.vote_timestamp, "-")}
                  </td>

                  <td>
                    {vote.blockchain_tx_id ? (
                      <span className="status-pill !bg-emerald-100 !text-emerald-700">
                        Recorded
                      </span>
                    ) : (
                      <span className="status-pill !bg-orange-100 !text-orange-700">
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default BoardVotingMonitor;
