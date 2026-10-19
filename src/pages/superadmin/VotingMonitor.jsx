import { useEffect, useState } from "react";
import "./RemainingPages.css";
import { RefreshCw, Vote, Users, Clock } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { callVoteAccess } from "../../utils/voteAccess";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { formatLocalDateTime } from "../../utils/time";
import { loadElectionTurnout, formatTurnoutPercentage, turnoutMetricValue, turnoutAvailabilityLabel } from "../../utils/electionTurnout";

function VotingMonitor() {
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("all");
  const [turnoutSummary, setTurnoutSummary] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData(electionValue = selectedElection) {
    const [voteResult, { data: electionsData, error: electionsError }] = await Promise.all([
      callVoteAccess("super_admin_voting_monitor"),
      supabase
        .from("elections")
        .select("id, title, organization_id")
        .order("id", { ascending: true }),
    ]);

    [voteResult.error, electionsError].filter(Boolean).forEach((error) => {
      console.error("Failed to load voting monitor data:", error);
    });

    setVotes(voteResult.data?.rows || []);
    setElections(electionsData || []);
    if (electionValue !== "all") {
      const turnoutResult = await loadElectionTurnout(electionValue);
      setTurnoutSummary(turnoutResult.error ? null : turnoutResult.data);
    } else {
      setTurnoutSummary(null);
    }
  }

  const filteredVotes =
    selectedElection === "all"
      ? votes
      : votes.filter((vote) => vote.election_id === Number(selectedElection));

  const totalVotes = filteredVotes.reduce((count, row) => count + Number(row.total_ballots || 0), 0);

  return (
    <div className="sa-remaining-page sa-voting-monitor">
      <SuperAdminPageHeader
        section="Election operations"
        title="Voting Monitor"
        description="Monitor vote submissions, turnout, and election activity."
        actions={<button onClick={fetchData} className="primary-btn"><RefreshCw size={18} />Refresh</button>}
      />

      <div className="mt-8 flex justify-between items-center">
        <select
          value={selectedElection}
          onChange={(e) => {
            const value = e.target.value;
            setSelectedElection(value);
            fetchData(value);
          }}
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Total Votes</p>
            <Vote className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{totalVotes}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Eligible Voters</p>
            <Users className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{turnoutMetricValue(turnoutSummary, "eligible_voters")}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Voters Participated</p>
            <Users className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{turnoutMetricValue(turnoutSummary, "participated_voters")}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Turnout</p>
            <Clock className="text-[#ff5a1f]" size={22} />
          </div>
          <h2 className="text-3xl font-black mt-2">{formatTurnoutPercentage(turnoutSummary)}</h2>
          <p className="mt-2 text-xs text-gray-500">{turnoutSummary ? turnoutAvailabilityLabel(turnoutSummary) : "Select an election for turnout."}</p>
        </div>
      </div>

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th className="px-6 py-4 text-sm">Submitted</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Ballot V1</th>
              <th className="px-6 py-4 text-sm">Legacy Records</th>
              <th className="px-6 py-4 text-sm">Latest Submission</th>
              <th className="px-6 py-4 text-sm">Anchor Queue</th>
            </tr>
          </thead>

          <tbody>
            {filteredVotes.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No aggregate vote activity is available.
                </td>
              </tr>
            ) : (
              filteredVotes.map((vote) => (
                <tr key={vote.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{vote.total_ballots}</td>

                  <td className="px-6 py-4">
                    {vote.elections?.title || "-"}
                  </td>

                  <td className="px-6 py-4">
                    {vote.ballot_count}
                  </td>

                  <td className="px-6 py-4">{vote.legacy_voter_count}</td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatLocalDateTime(vote.latest_submission, "-")}
                  </td>

                  <td className="px-6 py-4">
                    <span className="text-xs font-bold">
                      {vote.pending_anchors} pending · {vote.failed_anchors} attention
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default VotingMonitor;
