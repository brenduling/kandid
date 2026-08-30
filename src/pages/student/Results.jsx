import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { canStudentViewResults } from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import {
  buildElectionAnalytics,
  isMissingResultReleaseColumn,
  resultVisibilityLabel,
} from "../../utils/results";
import { isMissingPositionOrderError } from "../../utils/positionOrder";
import {
  ElectionResultsChart,
  HorizontalStatChart,
} from "../../components/ResultsVisualization";

async function fetchResultVotes(electionIds, includeDisplayOrder = true) {
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
        photo,
        students (first_name, last_name, photo_url),
        partylists (name)
      ),
      positions (${positionColumns})
    `)
    .in("election_id", electionIds);
}

async function fetchResultCandidates(electionId, includeDisplayOrder = true) {
  const positionColumns = includeDisplayOrder ? "id, name, display_order, election_id" : "id, name, election_id";

  if (!electionId) {
    return { data: [], error: null };
  }

  return supabase
    .from("candidates")
    .select(`
      id,
      photo,
      position_id,
      students (first_name, last_name, photo_url),
      partylists (name),
      positions!inner (${positionColumns})
    `)
    .eq("positions.election_id", electionId);
}

const electionSelectWithRelease =
  "id, title, status, start_date, end_date, student_result_visibility, results_released_at, organization_id, organizations(name)";
const electionSelectWithoutRelease =
  "id, title, status, start_date, end_date, student_result_visibility, organization_id, organizations(name)";

async function fetchResultElections(organizationIds, includeReleaseColumn = true) {
  const { data, error } = await supabase
    .from("elections")
    .select(includeReleaseColumn ? electionSelectWithRelease : electionSelectWithoutRelease)
    .in("organization_id", organizationIds)
    .neq("status", "draft")
    .neq("status", "archived")
    .order("start_date", { ascending: false });

  return {
    data: (data || []).map((election) => ({
      ...election,
      results_released_at: election.results_released_at || null,
    })),
    error,
  };
}

function StudentResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [voteLoadError, setVoteLoadError] = useState("");
  const [selectedElection, setSelectedElection] = useState(
    searchParams.get("election") || ""
  );

  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadResults() {
      const organizationIds = await getStudentElectionOrganizationIds(user);

      if (organizationIds.length === 0) return;

      let { data: electionData, error: electionError } =
        await fetchResultElections(organizationIds);

      if (isMissingResultReleaseColumn(electionError)) {
        const fallback = await fetchResultElections(organizationIds, false);
        electionData = fallback.data;
        electionError = fallback.error;
      }

      if (!active) return;

      const visibleElections = electionError ? [] : electionData || [];
      setElections(visibleElections);
      setSelectedElection((current) => {
        if (current) return current;
        return String(visibleElections.find((election) => canStudentViewResults(election))?.id || "");
      });
    }

    loadResults();

    return () => {
      active = false;
    };
  }, [user.id]);

  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );

  useEffect(() => {
    let active = true;

    async function loadSelectedVotes() {
      setVotes([]);
      setCandidates([]);
      setVoteLoadError("");

      if (!activeElection || !canStudentViewResults(activeElection)) return;

      let { data: voteData, error: voteError } = await fetchResultVotes([
        activeElection.id,
      ]);

      if (isMissingPositionOrderError(voteError)) {
        const fallback = await fetchResultVotes([activeElection.id], false);
        voteData = (fallback.data || []).map((vote) => ({
          ...vote,
          positions: {
            ...vote.positions,
            display_order: vote.position_id,
          },
        }));
        voteError = fallback.error;
      }

      if (!active) return;

      if (voteError) {
        setVoteLoadError(voteError.message || "Unable to load result totals.");
        return;
      }

      setVotes(voteData || []);

      let { data: candidateData, error: candidateError } = await fetchResultCandidates(activeElection.id);

      if (isMissingPositionOrderError(candidateError)) {
        const fallback = await fetchResultCandidates(activeElection.id, false);
        candidateData = (fallback.data || []).map((candidate) => ({
          ...candidate,
          positions: {
            ...candidate.positions,
            display_order: candidate.position_id,
          },
        }));
        candidateError = fallback.error;
      }

      if (!active) return;

      if (candidateError) {
        setVoteLoadError(candidateError.message || "Unable to load candidate totals.");
        return;
      }

      setCandidates(candidateData || []);
    }

    loadSelectedVotes();

    return () => {
      active = false;
    };
  }, [activeElection]);

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

    return buildElectionAnalytics(filteredVotes, activeElection, candidates);
  }, [activeElection, candidates, selectedElection, votes]);

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
            {activeElection
              ? `${resultVisibilityLabel(
                  activeElection.student_result_visibility,
                  activeElection.results_released_at,
                )}: results are not available to students yet.`
              : "Results are hidden until the election team releases them."}
          </div>
        ) : voteLoadError ? (
          <div className="glass-panel rounded-[28px] p-8 text-gray-500">
            {voteLoadError}
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
              <HorizontalStatChart
                eyebrow={analytics.allocationLabel}
                title="Voter distribution"
                subtitle="Published aggregate voter demographics for this election."
                badge={analytics.organizationName}
                items={analytics.allocationItems}
                mode={analytics.allocationMode}
              />

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

            <ElectionResultsChart
              groups={Object.values(analytics.groupedResults)}
              totalVoters={analytics.totalUniqueVoters}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default StudentResults;
