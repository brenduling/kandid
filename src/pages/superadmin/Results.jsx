import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";
import {
  buildElectionAnalytics,
  getResultVerificationSummary,
  normalizeResultVisibilityMode,
  resultVisibilityLabel,
  RESULT_VISIBILITY_MODES,
} from "../../utils/results";
import {
  fetchAuthoritativeNow,
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
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");
  const [releaseColumnReady, setReleaseColumnReady] = useState(true);
  const [voterBreakdownMode, setVoterBreakdownMode] = useState("program");
  const [voteLoadError, setVoteLoadError] = useState("");
  const [resultDimensions, setResultDimensions] = useState({ programs: [], yearLevels: [] });
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
      setVotes([]);
      setCandidates([]);
      setResultDimensions({ programs: [], yearLevels: [] });
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

      const [resultDataset, dimensions] = await Promise.all([
        fetchElectionResultDataset(election),
        fetchResultDimensions(election),
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
  }

  async function fetchData(active = true) {
    await fetchElections(active);
  }

  const filteredVotes = votes.filter(
    (v) => v.election_id === Number(selectedElection)
  );
  const filteredCandidates = candidates.filter(
    (candidate) => candidate.positions?.election_id === Number(selectedElection)
  );
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
  const phase = activeElection ? getElectionPhase(activeElection) : "";
  const canPublishResults =
    releaseColumnReady &&
    activeElection &&
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
      title: activeElection.results_released_at ? "Update Official Release?" : "Publish Official Results?",
      message: `${activeElection.title}\n\nVote entries: ${verification.totalVoteEntries}\nMissing vote hashes: ${verification.missingHash}\nDuplicate vote row IDs: ${verification.duplicateVoteIds}\n\nPublishing will make official aggregate results visible to eligible students.`,
      type: "primary",
      confirmText: activeElection.results_released_at ? "Update Release" : "Publish Results",
    });

    if (!confirmed) return;

    const serverNow = await fetchAuthoritativeNow();
    const { error } = await supabase
      .from("elections")
      .update({
        results_released_at: serverNow.toISOString(),
      })
      .eq("id", activeElection.id);

    if (error) {
      prompt.error(error.message || "Failed to release results.");
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
              totalVoters={analytics.totalUniqueVoters}
              dimensions={analytics.resultDimensions}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default Results;
