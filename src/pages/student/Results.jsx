import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { fetchResultDimensions } from "../../utils/resultDimensions";
import { fetchElectionResultDataset } from "../../utils/resultDataLoader";
import {
  buildElectionAnalytics,
  isMissingResultReleaseColumn,
  resultVisibilityLabel,
} from "../../utils/results";
import {
  ElectionResultsChart,
  HorizontalStatChart,
} from "../../components/ResultsVisualization";
import ElectionCover from "../../components/ElectionCover";

const electionSelectWithRelease =
  "id, title, cover_url, status, start_date, end_date, student_result_visibility, results_released_at, organization_id, organizations(name)";
const electionSelectWithReleaseWithoutCover =
  "id, title, status, start_date, end_date, student_result_visibility, results_released_at, organization_id, organizations(name)";
const electionSelectWithoutRelease =
  "id, title, status, start_date, end_date, student_result_visibility, organization_id, organizations(name)";

async function fetchResultElections(
  organizationIds,
  includeReleaseColumn = true,
  includeCoverColumn = true,
) {
  const selectColumns = includeReleaseColumn
    ? includeCoverColumn
      ? electionSelectWithRelease
      : electionSelectWithReleaseWithoutCover
    : electionSelectWithoutRelease;
  const { data, error } = await supabase
    .from("elections")
    .select(selectColumns)
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
  const [voterBreakdownMode, setVoterBreakdownMode] = useState("program");
  const [resultDimensions, setResultDimensions] = useState({ programs: [], yearLevels: [] });
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

      if (isMissingElectionCoverColumn(electionError)) {
        const fallback = await fetchResultElections(organizationIds, true, false);
        electionData = fallback.data;
        electionError = fallback.error;
      }

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
      setResultDimensions({ programs: [], yearLevels: [] });
      setVoteLoadError("");

      if (!activeElection || !canStudentViewResults(activeElection)) return;

      const [resultDataset, dimensions] = await Promise.all([
        fetchElectionResultDataset(activeElection),
        fetchResultDimensions(activeElection),
      ]);

      const { votes: voteData, candidates: candidateData, error: resultsError } = resultDataset;

      if (!active) return;

      if (resultsError) {
        setVoteLoadError(resultsError.message || "Unable to load result totals.");
        return;
      }

      setVotes(voteData || []);
      setCandidates(candidateData || []);
      setResultDimensions(dimensions);
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
        programItems: [],
        yearLevelItems: [],
        organizationItems: [],
        organizationName: "Organization",
      };
    }

    const filteredVotes = votes.filter(
      (vote) => vote.election_id === Number(selectedElection)
    );

    return buildElectionAnalytics(
      filteredVotes,
      activeElection ? { ...activeElection, resultDimensions } : activeElection,
      candidates,
    );
  }, [activeElection, candidates, resultDimensions, selectedElection, votes]);
  const voterBreakdownConfig = {
    program: {
      label: "Program Allocation",
      items: analytics.programItems || analytics.allocationItems,
      mode: "program",
    },
    year_level: {
      label: "Year Level Allocation",
      items: analytics.yearLevelItems || [],
      mode: "year_level",
    },
    organization: {
      label: "Organization Voters",
      items: analytics.organizationItems || [],
      mode: "organization",
    },
  }[voterBreakdownMode];

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
      {activeElection?.cover_url ? (
        <div className="mt-4 max-w-xl">
          <ElectionCover election={activeElection} />
        </div>
      ) : null}

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
                eyebrow={voterBreakdownConfig.label}
                title="Voter distribution"
                subtitle="Published aggregate voter demographics for this election."
                badge={analytics.organizationName}
                items={voterBreakdownConfig.items}
                mode={voterBreakdownConfig.mode}
                filters={[
                  { value: "program", label: "Program" },
                  { value: "year_level", label: "Year Level" },
                  { value: "organization", label: "Organization" },
                ]}
                activeFilter={voterBreakdownMode}
                onFilterChange={setVoterBreakdownMode}
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
              dimensions={analytics.resultDimensions}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default StudentResults;
