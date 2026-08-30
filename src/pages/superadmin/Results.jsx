import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { buildElectionAnalytics } from "../../utils/results";
import { isMissingPositionOrderError } from "../../utils/positionOrder";
import { fetchAuthoritativeNow } from "../../utils/elections";

const RELEASE_COLUMN_SELECT = "id, title, organization_id, results_released_at, organizations(name)";
const BASE_ELECTION_SELECT = "id, title, organization_id, organizations(name)";

function isMissingReleaseColumn(error) {
  const message = error?.message || "";
  return /results_released_at|schema cache|column .*does not exist/i.test(message);
}

async function fetchResultVotes(includeDisplayOrder = true) {
  const positionColumns = includeDisplayOrder ? "id, name, display_order" : "id, name";

  return supabase
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
      positions (${positionColumns}),
      elections (
        id,
        title,
        organization_id,
        organizations(name)
      )
    `);
}

function Results() {
  const prompt = usePrompt();
  const [votes, setVotes] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");
  const [releaseColumnReady, setReleaseColumnReady] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadData() {
      await fetchData(active);
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  async function fetchData(active = true) {
      let { data: votesData, error: votesError } = await fetchResultVotes();

      if (isMissingPositionOrderError(votesError)) {
        const fallback = await fetchResultVotes(false);
        votesData = (fallback.data || []).map((vote) => ({
          ...vote,
          positions: {
            ...vote.positions,
            display_order: vote.position_id,
          },
        }));
        votesError = fallback.error;
      }

      let { data: electionsData, error: electionsError } = await supabase
        .from("elections")
        .select(RELEASE_COLUMN_SELECT);

      if (isMissingReleaseColumn(electionsError)) {
        setReleaseColumnReady(false);
        const fallback = await supabase
          .from("elections")
          .select(BASE_ELECTION_SELECT);
        electionsData = fallback.data?.map((election) => ({
          ...election,
          results_released_at: null,
        }));
        electionsError = fallback.error;
      } else {
        setReleaseColumnReady(true);
      }

      if (!active) return;

      setVotes(votesError ? [] : votesData || []);
      if (electionsError) {
        prompt.error(electionsError.message || "Failed to load elections.");
        setElections([]);
        return;
      }

      setElections(electionsData || []);
  }

  const filteredVotes = votes.filter(
    (v) => v.election_id === Number(selectedElection)
  );
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );
  const analytics = buildElectionAnalytics(filteredVotes, activeElection);

  async function releaseResults() {
    if (!activeElection) return;

    if (!releaseColumnReady) {
      prompt.error("Apply the result release migration in Supabase before releasing results.");
      return;
    }

    const confirmed = await prompt.confirm({
      title: activeElection.results_released_at ? "Update Result Release?" : "Release Results?",
      message: `Make ${activeElection.title} results visible to eligible students?`,
      type: "primary",
      confirmText: activeElection.results_released_at ? "Update Release" : "Release Results",
    });

    if (!confirmed) return;

    const serverNow = await fetchAuthoritativeNow();
    const { error } = await supabase
      .from("elections")
      .update({ results_released_at: serverNow.toISOString() })
      .eq("id", activeElection.id);

    if (error) {
      prompt.error(error.message || "Failed to release results.");
      return;
    }

    prompt.success("Results are now visible to eligible students.");
    await fetchData();
  }

  return (
    <div>
      <h1 className="text-3xl font-black">Results Management</h1>
      <p className="text-gray-500 mt-1">
        View election results and vote tally.
      </p>

      <div className="mt-6">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="bg-white px-4 py-3 rounded-xl shadow-sm outline-none"
        >
          <option value="">Select Election</option>
          {elections.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        {activeElection ? (
          <button
            type="button"
            onClick={releaseResults}
            className="primary-btn ml-3 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!releaseColumnReady}
          >
            {!releaseColumnReady
              ? "Release Setup Required"
              : activeElection.results_released_at
                ? "Results Released"
                : "Release Results"}
          </button>
        ) : null}
      </div>

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="text-gray-500">Select an election to view results.</div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="text-gray-500">No results yet.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {[
                ["Vote Entries", analytics.totalVoteEntries],
                ["Unique Voters", analytics.totalUniqueVoters],
                ["Abstain Count", analytics.totalAbstains],
              ].map(([label, value]) => (
                <div key={label} className="metric-card lift-card">
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <h2 className="mt-4 text-5xl font-black tracking-tight">{value}</h2>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
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
                  Election History
                </p>
                <h3 className="mt-3 text-3xl font-black">Cross-cycle comparison</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Super admins can review exact vote totals and voter allocation for
                  current and previous elections across all organizations from one place.
                </p>
              </div>
            </div>

            {Object.values(analytics.groupedResults).map((group, idx) => {
            const sortedCandidates = Object.values(group.candidates).sort(
              (a, b) => b.votes - a.votes
            );

            return (
              <div key={idx} className="bg-white p-6 rounded-2xl shadow-sm">
                <h2 className="text-xl font-black mb-4">
                  {group.position}
                </h2>

                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="py-2">Candidate</th>
                      <th className="py-2">Votes</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedCandidates.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 font-semibold">{c.name}</td>
                        <td className="py-2">{c.votes}</td>
                        <td className="py-2">
                          {i === 0 ? (
                            <span className="text-green-600 font-bold">
                              Leading
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="py-2 font-semibold text-gray-500">
                        Abstain
                      </td>
                      <td className="py-2">{group.abstain}</td>
                      <td>-</td>
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

export default Results;
