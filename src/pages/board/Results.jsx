import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
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
import {
  ElectionResultsChart,
  HorizontalStatChart,
} from "../../components/ResultsVisualization";

const RELEASE_COLUMN_SELECT =
  "id, title, status, end_date, organization_id, student_result_visibility, results_released_at, organizations(name)";
const BASE_ELECTION_SELECT = "id, title, organization_id, organizations(name)";

function isMissingReleaseColumn(error) {
  const message = error?.message || "";
  return /results_released_at|schema cache|column .*does not exist/i.test(message);
}

async function fetchBoardVotes(electionIds, includeDisplayOrder = true) {
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
        partylists (name),
        students (
          first_name,
          last_name,
          photo_url
        )
      ),
      positions (
        ${positionColumns}
      ),
      elections (
        id,
        title
      )
    `)
    .in("election_id", electionIds);
}

async function fetchBoardCandidates(electionIds, includeDisplayOrder = true) {
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

function BoardResults() {
  const prompt = usePrompt();
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState("");
  const [releaseColumnReady, setReleaseColumnReady] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) return;

      let { data: orgElections, error: electionsError } = await supabase
        .from("elections")
        .select(RELEASE_COLUMN_SELECT)
        .eq("organization_id", orgId)
        .order("end_date", { ascending: false });

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

      if (!active) return;
      if (electionsError) {
        prompt.error(electionsError.message || "Failed to load elections.");
        setElections([]);
        setVotes([]);
        setCandidates([]);
        return;
      }

      setElections(orgElections || []);
      setSelectedElection((current) => current || String(orgElections?.[0]?.id || ""));

      if (electionIds.length === 0) {
        setVotes([]);
        setCandidates([]);
        return;
      }

      let { data: voteData, error } = await fetchBoardVotes(electionIds);

      if (isMissingPositionOrderError(error)) {
        const fallback = await fetchBoardVotes(electionIds, false);
        voteData = (fallback.data || []).map((vote) => ({
          ...vote,
          positions: {
            ...vote.positions,
            display_order: vote.position_id,
          },
        }));
        error = fallback.error;
      }

      if (!active) return;

      if (!error) setVotes(voteData || []);
      if (error) console.log(error);

      let { data: candidateData, error: candidateError } = await fetchBoardCandidates(electionIds);

      if (isMissingPositionOrderError(candidateError)) {
        const fallback = await fetchBoardCandidates(electionIds, false);
        candidateData = (fallback.data || []).map((candidate) => ({
          ...candidate,
          positions: {
            ...candidate.positions,
            display_order: candidate.position_id,
          },
        }));
        candidateError = fallback.error;
      }

      if (!candidateError) setCandidates(candidateData || []);
    }

    loadData();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function fetchData() {
    if (!orgId) return;

    let { data: orgElections, error: electionsError } = await supabase
      .from("elections")
      .select(RELEASE_COLUMN_SELECT)
      .eq("organization_id", orgId)
      .order("end_date", { ascending: false });

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
      setElections([]);
      setVotes([]);
      setCandidates([]);
      return;
    }

    setElections(orgElections || []);
    setSelectedElection((current) => current || String(orgElections?.[0]?.id || ""));

    if (electionIds.length === 0) {
      setVotes([]);
      setCandidates([]);
      return;
    }

    let { data: voteData, error } = await fetchBoardVotes(electionIds);

    if (isMissingPositionOrderError(error)) {
      const fallback = await fetchBoardVotes(electionIds, false);
      voteData = (fallback.data || []).map((vote) => ({
        ...vote,
        positions: {
          ...vote.positions,
          display_order: vote.position_id,
        },
      }));
      error = fallback.error;
    }

    if (!error) setVotes(voteData || []);
    if (error) console.log(error);

    let { data: candidateData, error: candidateError } = await fetchBoardCandidates(electionIds);

    if (isMissingPositionOrderError(candidateError)) {
      const fallback = await fetchBoardCandidates(electionIds, false);
      candidateData = (fallback.data || []).map((candidate) => ({
        ...candidate,
        positions: {
          ...candidate.positions,
          display_order: candidate.position_id,
        },
      }));
      candidateError = fallback.error;
    }

    if (!candidateError) setCandidates(candidateData || []);
  }

  const filteredVotes = selectedElection
    ? votes.filter((vote) => vote.election_id === Number(selectedElection))
    : [];
  const filteredCandidates = selectedElection
    ? candidates.filter((candidate) => candidate.positions?.election_id === Number(selectedElection))
    : [];
  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );
  const analytics = buildElectionAnalytics(filteredVotes, activeElection, filteredCandidates);
  const verification = getResultVerificationSummary(filteredVotes);
  const activeVisibilityMode = normalizeResultVisibilityMode(
    activeElection?.student_result_visibility,
  );
  const phase = activeElection ? getElectionPhase(activeElection) : "";

  async function releaseResults() {
    if (!activeElection) return;

    if (!releaseColumnReady) {
      prompt.error("Apply the result release migration in Supabase before releasing results.");
      return;
    }

    if (activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL) {
      prompt.error("Manual result publishing is restricted to Super Admin.");
      return;
    }

    if (phase !== "closed") {
      prompt.error("Results can only be released after voting has closed.");
      return;
    }

    if (!verification.verified) {
      prompt.error("Complete vote verification before releasing results.");
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
      .eq("id", activeElection.id)
      .eq("organization_id", orgId);

    if (error) {
      prompt.error(error.message || "Failed to release results.");
      return;
    }

    prompt.success("Results are now visible to eligible students.");
    await fetchData();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Board Results</h1>
          <p className="text-gray-500 mt-1">
            View vote tallies for your organization elections.
          </p>
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="mt-6">
        <select
          value={selectedElection}
          onChange={(e) => setSelectedElection(e.target.value)}
          className="bg-white px-4 py-3 rounded-xl shadow-sm outline-none"
        >
          <option value="">Select Election</option>
          {elections.map((election) => (
            <option key={election.id} value={election.id}>
              {election.title}
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
                : activeVisibilityMode === RESULT_VISIBILITY_MODES.MANUAL
                  ? "Super Admin Release"
                  : "Release Results"}
          </button>
        ) : null}
      </div>

      <div className="mt-8 space-y-6">
        {!selectedElection ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            Select an election to view results.
          </div>
        ) : Object.keys(analytics.groupedResults).length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-gray-500">
            No results yet.
          </div>
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
                subtitle="Unique voters grouped from your organization's election vote records."
                badge={analytics.organizationName}
                items={analytics.allocationItems}
                mode={analytics.allocationMode}
              />

              <div className="glass-panel-dark rounded-[30px] p-7 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                  Historical Tracking
                </p>
                <h3 className="mt-3 text-3xl font-black">Previous and current elections</h3>
                <p className="mt-4 text-sm leading-7 text-white/65">
                  Choose any election from your organization to review exact counts,
                  turnout, and program or year-level allocation, including older cycles.
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

export default BoardResults;
