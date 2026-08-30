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
import { isMissingPositionOrderError } from "../../utils/positionOrder";
import { fetchAuthoritativeNow, getElectionPhase } from "../../utils/elections";
import { logAuditEvent } from "../../utils/auditLog";
import {
  ElectionResultsChart,
  HorizontalStatChart,
} from "../../components/ResultsVisualization";

const RELEASE_COLUMN_SELECT =
  "id, title, status, end_date, organization_id, student_result_visibility, results_released_at, results_released_by, organizations(name)";
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
        photo,
        students (first_name, last_name, photo_url),
        partylists (name)
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

async function fetchResultCandidates(electionIds, includeDisplayOrder = true) {
  const positionColumns = includeDisplayOrder ? "id, name, display_order, election_id" : "id, name, election_id";

  if (!electionIds.length) {
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
    .in("positions.election_id", electionIds);
}

function Results() {
  const prompt = usePrompt();
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
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
        .select(RELEASE_COLUMN_SELECT)
        .order("end_date", { ascending: false });

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

      setVotes(votesError ? [] : votesData || []);
      if (electionsError) {
        prompt.error(electionsError.message || "Failed to load elections.");
        setElections([]);
        setCandidates([]);
        return;
      }

      setElections(electionsData || []);
      setSelectedElection((current) => current || String(electionsData?.[0]?.id || ""));

      const electionIds = (electionsData || []).map((election) => election.id);
      let { data: candidateData, error: candidateError } = await fetchResultCandidates(electionIds);

      if (isMissingPositionOrderError(candidateError)) {
        const fallback = await fetchResultCandidates(electionIds, false);
        candidateData = (fallback.data || []).map((candidate) => ({
          ...candidate,
          positions: {
            ...candidate.positions,
            display_order: candidate.position_id,
          },
        }));
        candidateError = fallback.error;
      }

      setCandidates(candidateError ? [] : candidateData || []);
  }

  const filteredVotes = votes.filter(
    (v) => v.election_id === Number(selectedElection)
  );
  const filteredCandidates = candidates.filter(
    (candidate) => candidate.positions?.election_id === Number(selectedElection)
  );
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );
  const analytics = buildElectionAnalytics(filteredVotes, activeElection, filteredCandidates);
  const verification = getResultVerificationSummary(filteredVotes);
  const activeVisibilityMode = normalizeResultVisibilityMode(
    activeElection?.student_result_visibility,
  );
  const phase = activeElection ? getElectionPhase(activeElection) : "";
  const canPublishResults =
    releaseColumnReady &&
    activeElection &&
    activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL &&
    phase === "closed" &&
    verification.verified;

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

    if (!verification.verified) {
      prompt.error("Complete vote verification before publishing results.");
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
            {!releaseColumnReady
              ? "Release Setup Required"
              : activeElection.results_released_at
                ? "Results Released"
                : activeVisibilityMode !== RESULT_VISIBILITY_MODES.MANUAL
                  ? resultVisibilityLabel(activeVisibilityMode)
                  : verification.verified
                    ? "Publish Results"
                    : "Verification Required"}
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
                eyebrow={analytics.allocationLabel}
                title="Voter distribution"
                subtitle="Unique voters grouped from the existing election vote records."
                badge={analytics.organizationName}
                items={analytics.allocationItems}
                mode={analytics.allocationMode}
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
            />
          </>
        )}
      </div>
    </div>
  );
}

export default Results;
