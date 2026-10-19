import { useCallback, useEffect, useState } from "react";
import "./BoardRemainingPages.css";
import "./Results.css";
import { RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import { toBoardFacingError } from "../../utils/boardFeedback";
import { logAuditEvent } from "../../utils/auditLog";
import {
  buildElectionAnalytics,
  getResultVerificationSummary,
  normalizeResultVisibilityMode,
  resultVisibilityLabel,
  RESULT_VISIBILITY_MODES,
} from "../../utils/results";
import {
  canStudentViewResults,
  getElectionPhase,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { fetchResultDimensions } from "../../utils/resultDimensions";
import { fetchElectionResultDataset } from "../../utils/resultDataLoader";
import {
  ElectionResultsChart,
  HorizontalStatChart,
} from "../../components/ResultsVisualization";
import ElectionCover from "../../components/ElectionCover";
import { loadElectionTurnout, formatTurnoutPercentage, turnoutMetricValue, turnoutAvailabilityLabel } from "../../utils/electionTurnout";
import { useElectionClock } from "../../utils/useElectionClock";

const RELEASE_COLUMN_SELECT =
  "id, title, cover_url, status, end_date, organization_id, student_result_visibility, results_released_at, organizations(name)";
const RELEASE_COLUMN_SELECT_WITHOUT_COVER =
  "id, title, status, end_date, organization_id, student_result_visibility, results_released_at, organizations(name)";
const BASE_ELECTION_SELECT = "id, title, organization_id, organizations(name)";

function isMissingReleaseColumn(error) {
  const message = error?.message || "";
  return /results_released_at|schema cache|column .*does not exist/i.test(message);
}

function BoardResults() {
  const prompt = usePrompt();
  const now = useElectionClock();
  const { error: showError } = prompt;
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [elections, setElections] = useState([]);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsLoadError, setElectionsLoadError] = useState("");
  const [selectedElection, setSelectedElection] = useState("");
  const [releaseColumnReady, setReleaseColumnReady] = useState(true);
  const [voterBreakdownMode, setVoterBreakdownMode] = useState("program");
  const [voteLoadError, setVoteLoadError] = useState("");
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultDimensions, setResultDimensions] = useState({ programs: [], yearLevels: [] });
  const [turnoutSummary, setTurnoutSummary] = useState(null);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "your organization";
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );

  const loadSelectedElectionResults = useCallback(async (election, active = true) => {
    setVoteLoadError("");
    setResultsLoading(true);
    setVotes([]);
    setCandidates([]);
    setResultDimensions({ programs: [], yearLevels: [] });
    setTurnoutSummary(null);

    const [resultDataset, dimensions, turnoutResult] = await Promise.all([
      fetchElectionResultDataset(election),
      fetchResultDimensions(election),
      loadElectionTurnout(election.id),
    ]);

    const { votes: voteData, candidates: candidateData, error } = resultDataset;

    if (!active) return;

    if (error) {
      const message = toBoardFacingError(error.message, "Failed to load result records.");
      setVoteLoadError(message);
      showError(message);
      setVotes([]);
      setCandidates([]);
    } else {
      setVotes(voteData || []);
      setCandidates(candidateData || []);
    }

    setResultDimensions(dimensions);
    setTurnoutSummary(turnoutResult.error ? null : turnoutResult.data);
    setResultsLoading(false);
  }, [showError]);


  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) {
        setElectionsLoading(false);
        setElectionsLoadError("This Board account has no assigned organization.");
        return;
      }
      setElectionsLoading(true);
      setElectionsLoadError("");
      setVoteLoadError("");

      let { data: orgElections, error: electionsError } = await supabase
        .from("elections")
        .select(RELEASE_COLUMN_SELECT)
        .eq("organization_id", orgId)
        .order("end_date", { ascending: false });

      if (isMissingElectionCoverColumn(electionsError)) {
        const fallback = await supabase
          .from("elections")
          .select(RELEASE_COLUMN_SELECT_WITHOUT_COVER)
          .eq("organization_id", orgId)
          .order("end_date", { ascending: false });
        orgElections = fallback.data;
        electionsError = fallback.error;
      }

      if (isMissingReleaseColumn(electionsError)) {
        setReleaseColumnReady(false);
        const fallback = await supabase
          .from("elections")
          .select(BASE_ELECTION_SELECT)
          .eq("organization_id", orgId)
          .order("id", { ascending: false });
        orgElections = fallback.data?.map((election) => ({
          ...election,
          results_released_at: null,
        }));
        electionsError = fallback.error;
      } else {
        setReleaseColumnReady(true);
      }

      if (!active) return;
      if (electionsError) {
        showError(electionsError.message || "Failed to load elections.");
        setElectionsLoadError(toBoardFacingError(electionsError.message, "Failed to load elections."));
        setElections([]);
        setVotes([]);
        setCandidates([]);
        setElectionsLoading(false);
        return;
      }

      setElections(orgElections || []);
      setSelectedElection((current) => current || String(orgElections?.[0]?.id || ""));
      setElectionsLoading(false);
    }

    loadData();

    return () => {
      active = false;
    };
  }, [orgId, showError]);

  useEffect(() => {
    let active = true;

    if (!activeElection) {
      return () => {
        active = false;
      };
    }

    Promise.resolve().then(() => {
      if (active) loadSelectedElectionResults(activeElection, active);
    });

    return () => {
      active = false;
    };
  }, [activeElection, loadSelectedElectionResults]);

  async function fetchData() {
    if (!orgId) {
      setElectionsLoadError("This Board account has no assigned organization.");
      return;
    }
    setElectionsLoading(true);
    setElectionsLoadError("");
    setVoteLoadError("");

    let { data: orgElections, error: electionsError } = await supabase
      .from("elections")
      .select(RELEASE_COLUMN_SELECT)
      .eq("organization_id", orgId)
      .order("end_date", { ascending: false });

    if (isMissingElectionCoverColumn(electionsError)) {
      const fallback = await supabase
        .from("elections")
        .select(RELEASE_COLUMN_SELECT_WITHOUT_COVER)
        .eq("organization_id", orgId)
        .order("end_date", { ascending: false });
      orgElections = fallback.data;
      electionsError = fallback.error;
    }

    if (isMissingReleaseColumn(electionsError)) {
      setReleaseColumnReady(false);
      const fallback = await supabase
        .from("elections")
        .select(BASE_ELECTION_SELECT)
        .eq("organization_id", orgId)
        .order("id", { ascending: false });
      orgElections = fallback.data?.map((election) => ({
        ...election,
        results_released_at: null,
      }));
      electionsError = fallback.error;
    } else {
      setReleaseColumnReady(true);
    }

    const electionIds = orgElections?.map((e) => e.id) || [];

    if (electionsError) {
      prompt.error(electionsError.message || "Failed to load elections.");
      setElectionsLoadError(toBoardFacingError(electionsError.message, "Failed to load elections."));
      setElections([]);
      setVotes([]);
      setCandidates([]);
      setTurnoutSummary(null);
      setElectionsLoading(false);
      return;
    }

    setElections(orgElections || []);
    setSelectedElection((current) => current || String(orgElections?.[0]?.id || ""));
    setElectionsLoading(false);

    if (electionIds.length === 0) {
      setVotes([]);
      setCandidates([]);
      return;
    }

    if (activeElection) {
      await loadSelectedElectionResults(activeElection);
    }
  }


  const filteredVotes = selectedElection
    ? votes.filter((vote) => vote.election_id === Number(selectedElection))
    : [];
  const filteredCandidates = selectedElection
    ? candidates.filter((candidate) => candidate.positions?.election_id === Number(selectedElection))
    : [];
  const analytics = buildElectionAnalytics(
    filteredVotes,
    activeElection ? { ...activeElection, resultDimensions } : activeElection,
    filteredCandidates,
  );
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
  const verification = getResultVerificationSummary(filteredVotes);
  const activeVisibilityMode = normalizeResultVisibilityMode(
    activeElection?.student_result_visibility,
  );
  const phase = activeElection ? getElectionPhase(activeElection, now) : "";
  const canPublishResults =
    releaseColumnReady &&
    activeElection &&
    !activeElection.results_released_at &&
    activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL &&
    phase === "closed";
  const studentsCanViewResults = activeElection
    ? canStudentViewResults(activeElection, now)
    : false;
  const studentVisibilityState = !releaseColumnReady
    ? "Release status unavailable"
    : activeElection?.results_released_at
      ? resultVisibilityLabel(
          activeElection.student_result_visibility,
          activeElection.results_released_at,
        )
      : activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL
        ? "Manual release"
        : activeVisibilityMode === RESULT_VISIBILITY_MODES.REALTIME
          ? studentsCanViewResults ? "Visible during voting" : "Real-time during voting"
          : studentsCanViewResults ? "Visible after voting closes" : "After voting closes";
  const studentVisibilityNote = !releaseColumnReady
    ? "Student publication could not be confirmed."
    : activeElection?.results_released_at
      ? "Results have been published to students."
      : activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL
        ? phase === "closed"
          ? "Board publication is available."
          : "Board publication becomes available after voting closes."
        : activeVisibilityMode === RESULT_VISIBILITY_MODES.REALTIME
          ? studentsCanViewResults
            ? "Students can view these results while voting is open or after it closes."
            : "Students can view results once voting opens."
          : studentsCanViewResults
            ? "Students can view these results after voting closes."
            : "Students can view results when voting closes.";

  async function releaseResults() {
    if (!activeElection) return;
    if (activeElection.results_released_at) {
      await prompt.alert({ title: "Results already finalized", message: "This electionâ€™s results have already been finalized." });
      return;
    }

    if (!releaseColumnReady) {
      prompt.error("Apply the result release migration in Supabase before releasing results.");
      return;
    }

    if (activeVisibilityMode !== RESULT_VISIBILITY_MODES.MANUAL) {
      prompt.error("Manual publishing is only used for elections set to Manual admin release.");
      return;
    }

    if (phase !== "closed") {
      prompt.error("Results can only be released after voting has closed.");
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Release Results?",
      message: `Make ${activeElection.title} results visible to eligible students?`,
      type: "primary",
      confirmText: "Finalize Results",
    });

    if (!confirmed) return;

    let alreadyFinalized;
    try {
      const { data: releaseResult, error: releaseError } = await supabase.rpc(
        "kandid_finalize_officer_results",
        { p_election_id: activeElection.id },
      );
      if (releaseError) throw new Error(releaseError.message || "Failed to release results.");
      alreadyFinalized = releaseResult?.already_finalized === true;
    } catch (error) {
      prompt.error(toBoardFacingError(error.message, "Failed to release results."));
      return;
    }

    if (alreadyFinalized) {
      await prompt.alert({ title: "Results already finalized", message: "These results were already finalized." });
      await fetchData();
      return;
    }

    prompt.success("Results are now visible to eligible students.");
    await logAuditEvent({
      action: "results_published",
      entityType: "election",
      entityId: activeElection.id,
      entityLabel: activeElection.title,
      organizationId: orgId,
      organizationName: activeElection.organizations?.name,
      status: "completed",
      metadata: { visibility_mode: activeVisibilityMode },
    });
    await fetchData();
  }

  const hasResultGroups = Object.keys(analytics.groupedResults).length > 0;
  const hasVoteRecords = filteredVotes.some((vote) => !vote?._aggregate_summary);

  return (
    <main className="board-remaining-page board-results board-results-page">
      <header className="board-results-masthead">
        <div className="board-results-masthead-context">
          <span>Electoral Board / {orgName}</span>
          <span className="board-results-masthead-rule" aria-hidden="true" />
        </div>

        <div className="board-results-title-row">
          <h1>Results</h1>
          <button type="button" className="board-results-refresh" onClick={fetchData}>
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>

        <p className="board-results-standfirst">
          View election results and vote tallies for {orgName}.
        </p>
      </header>

      <section className="board-results-context" aria-label="Election context">
        <div className="board-results-election-identity">
          {activeElection?.cover_url ? (
            <ElectionCover
              election={activeElection}
              compact
              className="board-results-cover"
            />
          ) : null}
          <div>
            <p className="board-results-section-kicker">Election context / {orgName}</p>
            <h2>{activeElection?.title || "Select an election"}</h2>
            {activeElection ? (
              <p className="board-results-election-organization">
                {activeElection.organizations?.name || orgName}
              </p>
            ) : null}
          </div>
        </div>

        <div className="board-results-context-controls">
          <label className="board-results-election-select">
            <span>Election</span>
            <select
              value={selectedElection}
              onChange={(event) => setSelectedElection(event.target.value)}
            >
              <option value="">Select an election</option>
              {elections.map((election) => (
                <option key={election.id} value={election.id}>
                  {election.title}
                </option>
              ))}
            </select>
          </label>

          {activeElection ? (
            <div
              className="board-results-visibility"
              data-released={Boolean(activeElection.results_released_at)}
            >
              <span>Student result visibility</span>
              <strong>{studentVisibilityState}</strong>
              <p>{studentVisibilityNote}</p>
            </div>
          ) : null}

          {canPublishResults ? (
            <button type="button" onClick={releaseResults} className="board-results-publish">
              Publish results
            </button>
          ) : null}
        </div>
      </section>

      <section className="board-results-workspace" aria-label="Election results">
        {!selectedElection ? (
          <div className="board-results-state">
            <p className="board-results-section-kicker">
              {electionsLoadError ? "Elections unavailable" : elections.length === 0 ? "Elections" : "Results"}
            </p>
            <h2>
              {electionsLoadError
                ? "Elections could not be loaded"
                : electionsLoading
                  ? "Loading elections"
                  : elections.length === 0
                    ? "No elections available"
                    : "Select an election"}
            </h2>
            <p>
              {electionsLoadError
                ? electionsLoadError
                : electionsLoading
                  ? "Loading elections for your organization."
                  : elections.length === 0
                    ? `There are no elections available for ${orgName}.`
                    : "Choose an election above to view its position results and candidate vote totals."}
            </p>
          </div>
        ) : !activeElection ? (
          <div className="board-results-state">
            <p className="board-results-section-kicker">Election unavailable</p>
            <h2>Choose an available election</h2>
            <p>The selected election is not in the current organization election list.</p>
          </div>
        ) : voteLoadError ? (
          <div className="board-results-state is-error" role="alert">
            <p className="board-results-section-kicker">Results unavailable</p>
            <h2>Result records could not be loaded</h2>
            <p>{voteLoadError}</p>
          </div>
        ) : resultsLoading ? (
          <div className="board-results-skeleton" role="status" aria-label="Loading election results" aria-busy="true">
            <div className="board-results-skeleton-heading"><span /><span /></div>
            {[0, 1, 2].map((row) => (
              <div className="board-results-skeleton-position" key={row}>
                <span className="is-position" />
                {[0, 1, 2].map((candidate) => <span className="is-candidate" key={candidate} />)}
              </div>
            ))}
          </div>
        ) : !hasResultGroups ? (
          <div className="board-results-state">
            <p className="board-results-section-kicker">
              {activeElection?.results_released_at ? "Released results" : "Result records"}
            </p>
            <h2>No candidate or vote records available</h2>
            <p>
              This election has no candidate or vote records to display. The student result
              visibility setting is shown above; Board tallies are not hidden by that setting.
            </p>
          </div>
        ) : (
          <>
            {!hasVoteRecords ? (
              <div className="board-results-zero-vote" role="status">
                <p className="board-results-section-kicker">No votes recorded</p>
                <p>
                  No ballots have been recorded for this election yet. Position tallies below
                  show zero for every candidate and abstention until vote records exist.
                </p>
              </div>
            ) : null}
            <section className="grid grid-cols-1 gap-5 md:grid-cols-3" aria-label="Election voter turnout">
              {[
                ["Eligible voters", turnoutMetricValue(turnoutSummary, "eligible_voters")],
                ["Voters participated", turnoutMetricValue(turnoutSummary, "participated_voters")],
                ["Voter turnout", formatTurnoutPercentage(turnoutSummary)],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-black/15 pt-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-500">{label}</p>
                  <p className="mt-2 font-serif text-3xl font-bold">{value}</p>
                  {label === "Voter turnout" ? <p className="mt-1 text-xs text-gray-500">{turnoutAvailabilityLabel(turnoutSummary)}</p> : null}
                </div>
              ))}
            </section>
            <section className="board-results-tallies" aria-label="Results by position">
              <div className="board-results-section-heading">
                <p className="board-results-section-kicker">Position results</p>
                <h2>Candidate vote totals</h2>
              </div>

              <ElectionResultsChart
                groups={Object.values(analytics.groupedResults)}
                totalVoters={analytics.totalUniqueVoters}
                dimensions={analytics.resultDimensions}
                presentation="editorial"
              />

              {hasVoteRecords ? (
                <p className="board-results-verification">
                  Vote record check: {verification.verified ? "complete" : "review required"}
                  <span>{verification.totalVoteEntries} entries</span>
                  <span>{verification.missingHash} missing hashes</span>
                </p>
              ) : null}
            </section>

            <HorizontalStatChart
              eyebrow={voterBreakdownConfig.label}
              title="Voter distribution"
              subtitle="Unique voters grouped from this election's vote records."
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
              presentation="editorial"
            />
          </>
        )}
      </section>
    </main>
  );
}

export default BoardResults;
