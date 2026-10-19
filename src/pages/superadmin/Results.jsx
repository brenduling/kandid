import { useEffect, useState } from "react";
import "./RemainingPages.css";
import { supabase } from "../../lib/supabaseClient";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { usePrompt } from "../../context/PromptContext";
import {
  buildElectionAnalytics,
  getResultVerificationSummary,
  normalizeResultVisibilityMode,
  resultVisibilityLabel,
  RESULT_VISIBILITY_MODES,
} from "../../utils/results";
import {
  getElectionPhase,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { fetchResultDimensions } from "../../utils/resultDimensions";
import { fetchElectionResultDataset } from "../../utils/resultDataLoader";
import { logAuditEvent } from "../../utils/auditLog";
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

function Results() {
  const prompt = usePrompt();
  const now = useElectionClock();
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");
  const [releaseColumnReady, setReleaseColumnReady] = useState(true);
  const [voterBreakdownMode, setVoterBreakdownMode] = useState("program");
  const [voteLoadError, setVoteLoadError] = useState("");
  const [resultDimensions, setResultDimensions] = useState({ programs: [], yearLevels: [] });
  const [turnoutSummary, setTurnoutSummary] = useState(null);
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );

  useEffect(() => {
    let active = true;

    async function loadData() {
      await fetchElections(active);
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!activeElection) {
      return () => {
        active = false;
      };
    }

    loadSelectedElectionResults(activeElection, active);

    return () => {
      active = false;
    };
  }, [activeElection?.id]);

  async function fetchElections(active = true) {
      let { data: electionsData, error: electionsError } = await supabase
        .from("elections")
        .select(RELEASE_COLUMN_SELECT)
        .order("end_date", { ascending: false });

      if (isMissingElectionCoverColumn(electionsError)) {
        const fallback = await supabase
          .from("elections")
          .select(RELEASE_COLUMN_SELECT_WITHOUT_COVER)
          .order("end_date", { ascending: false });
        electionsData = fallback.data;
        electionsError = fallback.error;
      }

      if (isMissingReleaseColumn(electionsError)) {
        setReleaseColumnReady(false);
        const fallback = await supabase
          .from("elections")
          .select(BASE_ELECTION_SELECT)
          .order("id", { ascending: false });
        electionsData = fallback.data?.map((election) => ({
          ...election,
          results_released_at: null,
        }));
        electionsError = fallback.error;
      } else {
        setReleaseColumnReady(true);
      }

      if (!active) return;

      if (electionsError) {
        prompt.error(electionsError.message || "Failed to load elections.");
        setElections([]);
        setVotes([]);
        setCandidates([]);
        return;
      }

      setElections(electionsData || []);
      setSelectedElection((current) => current || String(electionsData?.[0]?.id || ""));
  }

  async function loadSelectedElectionResults(election, active = true) {
      setVoteLoadError("");
      setVotes([]);
      setCandidates([]);
      setResultDimensions({ programs: [], yearLevels: [] });

      const [resultDataset, dimensions, turnoutResult] = await Promise.all([
        fetchElectionResultDataset(election),
        fetchResultDimensions(election),
        loadElectionTurnout(election.id),
      ]);

      const { votes: votesData, candidates: candidateData, error: resultsError } = resultDataset;

      if (!active) return;

      if (resultsError) {
        const message = resultsError.message || "Failed to load result records.";
        setVoteLoadError(message);
        prompt.error(message);
        setVotes([]);
        setCandidates([]);
      } else {
        setVotes(votesData || []);
        setCandidates(candidateData || []);
      }

      setResultDimensions(dimensions);
      setTurnoutSummary(turnoutResult.error ? null : turnoutResult.data);
  }

  async function fetchData(active = true) {
    await fetchElections(active);
  }

  const filteredVotes = activeElection
    ? votes.filter((v) => v.election_id === Number(selectedElection))
    : [];
  const filteredCandidates = activeElection
    ? candidates.filter(
        (candidate) => candidate.positions?.election_id === Number(selectedElection)
      )
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
  const publishButtonLabel = !releaseColumnReady
    ? "Release Setup Required"
    : activeElection?.results_released_at
      ? "Results Released"
      : activeVisibilityMode !== RESULT_VISIBILITY_MODES.MANUAL
        ? resultVisibilityLabel(activeVisibilityMode)
        : phase !== "closed"
          ? "Publish After Voting Ends"
          : "Publish Results";

  async function releaseResults() {
    if (!activeElection) return;
    if (activeElection.results_released_at) {
      await prompt.alert({ title: "Results already finalized", message: "This election’s results have already been finalized." });
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
      prompt.error("Results can only be published after voting has closed.");
      return;
    }

    const confirmed = await prompt.confirm({
      title: "Publish Official Results?",
      message: `${activeElection.title}\n\nVote entries: ${verification.totalVoteEntries}\nMissing vote hashes: ${verification.missingHash}\nDuplicate vote row IDs: ${verification.duplicateVoteIds}\n\nPublishing will make official aggregate results visible to eligible students.`,
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
      prompt.error(error.message || "Failed to release results.");
      return;
    }

    if (alreadyFinalized) {
      await prompt.alert({ title: "Results already finalized", message: "These results were already finalized." });
      await fetchData();
      return;
    }


    await logAuditEvent({
      action: "results_published",
      entityType: "election",
      entityId: activeElection.id,
      entityLabel: activeElection.title,
      organizationId: activeElection.organization_id,
      organizationName: activeElection.organizations?.name,
      metadata: {
        visibility_mode: activeVisibilityMode,
        vote_entries: verification.totalVoteEntries,
      },
    });

    prompt.success("Election results published successfully.");
    await fetchData();
  }

  return (
    <div className="sa-remaining-page sa-results">
      <SuperAdminPageHeader section="Election operations" title="Results" description="Review election outcomes and published vote tallies." />

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
            disabled={!canPublishResults}
          >
            {publishButtonLabel}
          </button>
        ) : null}
      </div>
      {activeElection?.cover_url ? (
        <div className="mt-4 max-w-xl">
          <ElectionCover election={activeElection} />
        </div>
      ) : null}

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="text-gray-500">Select an election to view results.</div>
        ) : voteLoadError ? (
          <div className="empty-state">{voteLoadError}</div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="text-gray-500">No results yet.</div>
        ) : (
          <>
            {activeElection ? (
              <div className="soft-card">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                  Student Result Visibility
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  {resultVisibilityLabel(
                    activeElection.student_result_visibility,
                    activeElection.results_released_at,
                  )}
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  Verification: {verification.verified ? "Completed" : "Required"}.
                  Vote entries: {verification.totalVoteEntries}. Missing hashes:{" "}
                  {verification.missingHash}.
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {[
                ["Eligible Voters", turnoutMetricValue(turnoutSummary, "eligible_voters")],
                ["Voters Participated", turnoutMetricValue(turnoutSummary, "participated_voters")],
                ["Voter Turnout", formatTurnoutPercentage(turnoutSummary)],
                ["Abstain Count", analytics.totalAbstains],
              ].map(([label, value]) => (
                <div key={label} className="metric-card lift-card">
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <h2 className="mt-4 text-5xl font-black tracking-tight">{value}</h2>
                  {label === "Voter Turnout" ? <p className="mt-2 text-sm text-gray-500">{turnoutAvailabilityLabel(turnoutSummary)}</p> : null}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <HorizontalStatChart
                eyebrow={voterBreakdownConfig.label}
                title="Voter distribution"
                subtitle="Unique voters grouped from the existing election vote records."
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
                  Election History
                </p>
                <h3 className="mt-3 text-3xl font-black">Cross-cycle comparison</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Super admins can review exact vote totals and voter allocation for
                  current and previous elections across all organizations from one place.
                </p>
              </div>
            </div>

            <ElectionResultsChart
              groups={Object.values(analytics.groupedResults)}
              totalVoters={turnoutSummary?.participated_voters ?? analytics.totalUniqueVoters}
              dimensions={analytics.resultDimensions}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default Results;
