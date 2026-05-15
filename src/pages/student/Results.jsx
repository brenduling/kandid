import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { canStudentViewResults } from "../../utils/elections";
import { buildElectionAnalytics } from "../../utils/results";

function StudentResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [selectedElection, setSelectedElection] = useState(
    searchParams.get("election") || ""
  );

  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadResults() {
      const { data: studentOrgs } = await supabase
        .from("student_organizations")
        .select("organization_id")
        .eq("student_id", user.id);

      const organizationIds =
        studentOrgs?.map((item) => item.organization_id) || [];

      if (organizationIds.length === 0) return;

      const { data: electionData } = await supabase
        .from("elections")
        .select(
          "id, title, status, start_date, end_date, student_result_visibility, organization_id, organizations(name)"
        )
        .in("organization_id", organizationIds)
        .neq("status", "archived")
        .order("start_date", { ascending: false });

      const { data: voteData } = await supabase
        .from("votes")
        .select(`
          *,
          students (
            program,
            year_level
          ),
          candidates (
            id,
            students (first_name, last_name)
          ),
          positions (id, name)
        `)
        .in("election_id", (electionData || []).map((election) => election.id));

      if (!active) return;

      setElections(electionData || []);
      setVotes(voteData || []);
    }

    loadResults();

    return () => {
      active = false;
    };
  }, [user.id]);

  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );

  const analytics = useMemo(() => {
    if (!selectedElection) {
      return {
        groupedResults: {},
        totalVoteEntries: 0,
        totalUniqueVoters: 0,
        totalAbstains: 0,
        allocationLabel: "Allocation",
        allocationItems: [],
        organizationName: "Organization",
      };
    }

    const filteredVotes = votes.filter(
      (vote) => vote.election_id === Number(selectedElection)
    );

    return buildElectionAnalytics(filteredVotes, activeElection);
  }, [activeElection, selectedElection, votes]);

  function handleSelectElection(value) {
    setSelectedElection(value);
    if (value) setSearchParams({ election: value });
    else setSearchParams({});
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Results Center</div>
          <h1 className="page-title">
            Published election
            <span className="page-title-accent"> tallies</span>
          </h1>
          <p className="page-subtitle">
            Result visibility follows election settings. Students only see live or
            closed results when permitted by the election team.
          </p>
        </div>

        <div className="glass-panel-strong rounded-[24px] p-4">
          <label className="field-label">Choose Election</label>
          <select
            value={selectedElection}
            onChange={(e) => handleSelectElection(e.target.value)}
            className="field-shell min-w-[280px]"
          >
            <option value="">Select Election</option>
            {elections.map((election) => (
              <option key={election.id} value={election.id}>
                {election.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            Select an election to view results.
          </div>
        ) : !canStudentViewResults(activeElection) ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            Results are hidden until the election closes or real-time visibility is
            enabled.
          </div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            No results yet.
          </div>
        ) : (
          <>
            <div className="section-grid grid-cols-1 md:grid-cols-3">
              {[
                ["Vote Entries", analytics.totalVoteEntries, "All submitted vote rows in this election"],
                ["Unique Voters", analytics.totalUniqueVoters, `Student turnout for ${analytics.organizationName}`],
                ["Abstain Count", analytics.totalAbstains, "Recorded abstain selections across positions"],
              ].map(([label, value, hint]) => (
                <div key={label} className="metric-card lift-card">
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <h2 className="mt-4 text-5xl font-black tracking-tight">{value}</h2>
                  <p className="mt-3 text-sm text-gray-500">{hint}</p>
                </div>
              ))}
            </div>

            <div className="section-grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="soft-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                      {analytics.allocationLabel}
                    </p>
                    <h3 className="mt-2 text-2xl font-black">Voter distribution</h3>
                  </div>
                  <span className="status-pill">{analytics.organizationName}</span>
                </div>

                <div className="mt-6 space-y-4">
                  {analytics.allocationItems.map((item) => (
                    <div key={item.label} className="info-row">
                      <div>
                        <p className="text-sm font-bold text-[#1d262f]">{item.label}</p>
                        <p className="mt-1 text-xs text-gray-500">{item.percentage}% of voters</p>
                      </div>
                      <span className="text-lg font-black text-[#d35a25]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel-dark rounded-[30px] p-7 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                  Election Scope
                </p>
                <h3 className="mt-3 text-3xl font-black">Current and previous results</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Result summaries stay available for older elections in the same
                  selection list, so you can compare turnout and demographic allocation
                  across election cycles.
                </p>
              </div>
            </div>

            {Object.values(analytics.groupedResults).map((group, index) => {
            const sortedCandidates = Object.values(group.candidates).sort(
              (a, b) => b.votes - a.votes
            );

            return (
              <div
                key={group.position}
                className="table-shell fade-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="border-b border-[rgba(104,86,72,0.08)] px-6 py-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                    Position
                  </p>
                  <h2 className="mt-2 text-2xl font-black">{group.position}</h2>
                </div>

                <table className="w-full text-left">
                  <thead className="bg-white/35">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                        Candidate
                      </th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                        Vote Count
                      </th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                        Standing
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCandidates.map((candidate, rowIndex) => (
                      <tr
                        key={`${group.position}-${candidate.name}`}
                        className="border-b border-[rgba(104,86,72,0.08)] last:border-b-0"
                      >
                        <td className="px-6 py-4 font-semibold">{candidate.name}</td>
                        <td className="px-6 py-4">{candidate.votes}</td>
                        <td className="px-6 py-4">
                          {rowIndex === 0 ? (
                            <span className="status-pill !bg-[rgba(47,143,131,0.12)] !text-[#2f8f83]">
                              Leading
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="px-6 py-4 font-semibold text-gray-500">Abstain</td>
                      <td className="px-6 py-4">{group.abstain}</td>
                      <td className="px-6 py-4">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default StudentResults;
