import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
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
import { loadElectionTurnout, formatTurnoutPercentage, turnoutMetricValue, turnoutAvailabilityLabel } from "../../utils/electionTurnout";
import { getStoredUser } from "../../utils/auth";
import {
  STUDENT_RESULTS_ERROR_COPY,
  classifyStudentResultsError,
  studentAwaitingResultsCopy,
  studentResultsStatusMeta,
  studentZeroVoteCopy,
} from "../../utils/studentResults";

const electionSelectWithRelease =
  "id, title, cover_url, status, start_date, end_date, student_result_visibility, results_released_at, organization_id, organizations(name)";
const electionSelectWithReleaseWithoutCover =
  "id, title, status, start_date, end_date, student_result_visibility, results_released_at, organization_id, organizations(name)";
const electionSelectWithoutRelease =
  "id, title, status, start_date, end_date, student_result_visibility, organization_id, organizations(name)";

async function fetchResultElections(
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
    .neq("status", "draft")
    .order("start_date", { ascending: false });

  return {
    data: (data || []).map((election) => ({
      ...election,
      results_released_at: election.results_released_at || null,
    })),
    error,
  };
}

function electionMetaLine(election) {
  const parts = [];
  if (election.organizations?.name) parts.push(election.organizations.name);
  const visibility = resultVisibilityLabel(
    election.student_result_visibility,
    election.results_released_at,
  );
  if (visibility) parts.push(visibility);
  return parts.join(" · ");
}

function electionOrgName(election) {
  return election.organizations?.name || "Organization";
}

function ElectionChooser({ elections, selectedElection, onSelect }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const selected =
    elections.find((election) => election.id === Number(selectedElection)) || null;

  useEffect(() => {
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function choose(index) {
    const election = elections[index];
    if (election) onSelect(String(election.id));
    setOpen(false);
  }

  function openElectionChooser() {
    setActiveIndex(Math.max(elections.findIndex((e) => e.id === Number(selectedElection)), 0));
    setOpen(true);
  }

  function toggleElectionChooser() {
    if (open) {
      setOpen(false);
      return;
    }
    openElectionChooser();
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openElectionChooser();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, elections.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < elections.length) choose(activeIndex);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="student-elections-selector" ref={containerRef}>
      <label className="text-xs font-bold uppercase tracking-[0.18em] text-gray-600">
        Choose Election
      </label>
      <button
        type="button"
        className={`student-elections-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleElectionChooser}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="student-elections-trigger-copy">
          <strong>{selected ? selected.title : "Select Election"}</strong>
          <small>
            {selected
              ? electionMetaLine(selected)
              : elections.length === 0
                ? "No elections available"
                : "Select an election to view results"}
          </small>
        </span>
        <ChevronDown size={15} className="student-elections-trigger-chevron" />
      </button>

      {open ? (
        <ul className="student-elections-chooser" role="listbox" ref={listRef}>
          {elections.length === 0 ? (
            <li className="student-elections-chooser-empty" role="presentation">
              No elections available.
            </li>
          ) : (
            elections.map((election, index) => {
              const isSelected = election.id === Number(selectedElection);
              const isActive = index === activeIndex;
              return (
                <li key={election.id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    className={`student-elections-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                    onClick={() => choose(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    tabIndex={-1}
                    aria-selected={isSelected}
                  >
                    <span className="student-elections-option-copy">
                      <strong>{election.title}</strong>
                      <small>{electionOrgName(election)}</small>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

function ResultsLoadingSkeleton() {
  return (
    <StudentSkeletonGroup label="Loading results">
      <section className="results-chapter">
        <div className="student-skeleton-stack">
          <StudentSkeletonLine width="16%" height="0.6rem" />
          <StudentSkeletonLine width="34%" height="0.95rem" />
        </div>

        <div className="student-skeleton-stack student-results-skeleton-rows">
          {[0, 1, 2].map((index) => (
            <div className="student-skeleton-row" key={index}>
              <StudentSkeletonLine
                variant="media"
                width="2.7rem"
                height="2.7rem"
              />

              <div className="student-skeleton-copy">
                <StudentSkeletonLine width="46%" height="0.9rem" />
                <StudentSkeletonLine width="64%" height="0.6rem" />
              </div>

              <StudentSkeletonLine
                variant="track"
                width="100%"
                height="0.32rem"
              />
            </div>
          ))}
        </div>
      </section>
    </StudentSkeletonGroup>
  );
}

function StudentResultsStateBlock({ copy, meta, actionLabel, onAction, actionDisabled }) {
  if (!copy) return null;

  return (
    <div className="student-empty-card student-elections-state student-results-state">
      {copy.kicker ? (
        <span className="student-results-state-kicker">{copy.kicker}</span>
      ) : null}
      <h2 className="student-results-state-title">{copy.title}</h2>
      {copy.body ? (
        <p className="student-results-state-body">{copy.body}</p>
      ) : null}
      {meta ? <p className="student-results-state-meta">{meta}</p> : null}
      {actionLabel ? (
        <button
          type="button"
          className="student-results-refresh"
          onClick={onAction}
          disabled={actionDisabled}
        >
          <RefreshCw size={13} aria-hidden="true" />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function StudentResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [resultErrorKind, setResultErrorKind] = useState("");
  const [electionsErrorKind, setElectionsErrorKind] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [turnoutSummary, setTurnoutSummary] = useState(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [voterBreakdownMode, setVoterBreakdownMode] = useState("program");
  const [resultDimensions, setResultDimensions] = useState({ programs: [], yearLevels: [] });
  const [selectedElection, setSelectedElection] = useState(
    searchParams.get("election") || ""
  );

  const user = getStoredUser() || {};

  useEffect(() => {
    let active = true;

    async function loadResults() {
      setElectionsLoading(true);

      let { data: electionData, error: electionError } =
        await fetchResultElections();

      if (isMissingElectionCoverColumn(electionError)) {
        const fallback = await fetchResultElections(true, false);
        electionData = fallback.data;
        electionError = fallback.error;
      }

      if (isMissingResultReleaseColumn(electionError)) {
        const fallback = await fetchResultElections(false);
        electionData = fallback.data;
        electionError = fallback.error;
      }

      if (!active) return;

      if (electionError) {
        const errorKind = await classifyStudentResultsError(electionError);
        if (!active) return;
        setElectionsErrorKind(errorKind);
        setElections([]);
        setElectionsLoading(false);
        return;
      }

      const visibleElections = electionData || [];
      setElectionsErrorKind("");
      setElections(visibleElections);
      setSelectedElection((current) => {
        if (current) return current;
        return String(visibleElections.find((election) => canStudentViewResults(election))?.id || "");
      });
      setElectionsLoading(false);
    }

    loadResults();

    return () => {
      active = false;
    };
  }, [user.id, refreshNonce]);

  const activeElection = elections.find(
    (election) => election.id === Number(selectedElection)
  );

  useEffect(() => {
    let active = true;

    async function loadSelectedVotes() {
      setVotes([]);
      setCandidates([]);
      setResultDimensions({ programs: [], yearLevels: [] });
      setResultErrorKind("");
      setTurnoutSummary(null);

      if (!activeElection || !canStudentViewResults(activeElection)) return;

      setResultsLoading(true);

      // The turnout RPC is the server-side visibility and eligibility gate.
      // Do not fan out to tallies, candidate details, or demographic lookups
      // until it confirms that this student can see this election's results.
      const turnoutResult = await loadElectionTurnout(activeElection.id);
      if (!active) return;

      if (turnoutResult.error) {
        const errorKind = await classifyStudentResultsError(turnoutResult.error);
        if (!active) return;
        setResultErrorKind(errorKind);
        setResultsLoading(false);
        return;
      }

      const resultDataset = await fetchElectionResultDataset(activeElection);

      const { votes: voteData, candidates: candidateData, error: resultsError } = resultDataset;

      if (!active) return;

      if (resultsError) {
        const errorKind = await classifyStudentResultsError(resultsError);
        if (!active) return;
        setResultErrorKind(errorKind);
        setResultsLoading(false);
        return;
      }

      const dimensions = await fetchResultDimensions(activeElection, {
        includeMembershipDemographics: false,
      });
      if (!active) return;

      setVotes(voteData || []);
      setCandidates(candidateData || []);
      setResultDimensions(dimensions);
      setTurnoutSummary(turnoutResult.data);
      setResultsLoading(false);
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

  const hasGroupedResults = Object.keys(analytics.groupedResults).length > 0;
  const awaitingResultsCopy =
    activeElection && !canStudentViewResults(activeElection)
      ? studentAwaitingResultsCopy(activeElection)
      : null;
  const zeroVoteCopy =
    activeElection && !resultErrorKind && !hasGroupedResults
      ? studentZeroVoteCopy(activeElection)
      : null;
  const resultErrorCopy = resultErrorKind
    ? STUDENT_RESULTS_ERROR_COPY[resultErrorKind] || STUDENT_RESULTS_ERROR_COPY.backend
    : null;
  const electionsErrorCopy = electionsErrorKind
    ? STUDENT_RESULTS_ERROR_COPY[electionsErrorKind] || STUDENT_RESULTS_ERROR_COPY.backend
    : null;

  function handleSelectElection(value) {
    setSelectedElection(value);
    if (value) setSearchParams({ election: value });
    else setSearchParams({});
  }

  function handleRefreshResults() {
    setRefreshNonce((current) => current + 1);
  }

  return (
    <div className="student-elections-desktop">
      <header className="student-elections-opening">
        <div className="student-elections-opening-copy">
          <span className="student-elections-kicker">Results Center</span>
          <h1>Published election tallies</h1>
          <p>See the official results released by your election team.</p>
        </div>

        <ElectionChooser
          elections={elections}
          selectedElection={selectedElection}
          onSelect={handleSelectElection}
        />
      </header>

      {activeElection ? (
        <div className="flex items-center gap-4 py-1.5">
          {activeElection.cover_url ? (
            <div className="student-results-context-thumb">
              <ElectionCover election={activeElection} compact />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#ef4e23]">
              {analytics.organizationName}
            </span>
            <h2 className="truncate font-serif text-2xl font-bold leading-tight text-gray-900">
              {activeElection.title}
            </h2>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
              {resultVisibilityLabel(
                activeElection.student_result_visibility,
                activeElection.results_released_at,
              )}
            </span>
          </div>
          <button
            type="button"
            className="student-results-refresh"
            onClick={handleRefreshResults}
            disabled={electionsLoading || resultsLoading}
          >
            <RefreshCw size={13} aria-hidden="true" />
            Refresh
          </button>
        </div>
      ) : null}

      <div className="student-results-body space-y-5">
        {electionsLoading ? (
          <ResultsLoadingSkeleton />
        ) : electionsErrorCopy ? (
          <StudentResultsStateBlock
            copy={electionsErrorCopy}
            actionLabel={electionsErrorCopy.action}
            onAction={handleRefreshResults}
          />
        ) : !activeElection ? (
          <StudentResultsStateBlock
            copy={{
              kicker: "Results Center",
              title: "Select an election to view results",
              body:
                elections.length === 0
                  ? "No elections are available yet."
                  : "Choose an election from the list above to see its official tallies.",
            }}
          />
        ) : !canStudentViewResults(activeElection) ? (
          <StudentResultsStateBlock
            copy={awaitingResultsCopy}
            meta={studentResultsStatusMeta(activeElection)}
            actionLabel="Check again"
            onAction={handleRefreshResults}
          />
        ) : resultsLoading ? (
          <ResultsLoadingSkeleton />
        ) : resultErrorCopy ? (
          <StudentResultsStateBlock
            copy={resultErrorCopy}
            actionLabel={resultErrorCopy.action}
            onAction={handleRefreshResults}
          />
        ) : !hasGroupedResults ? (
          <StudentResultsStateBlock
            copy={zeroVoteCopy}
            meta={studentResultsStatusMeta(activeElection)}
            actionLabel="Refresh"
            onAction={handleRefreshResults}
          />
        ) : (
          <>
            <div className="student-summary-rail section-grid grid-cols-1 md:grid-cols-4">
              {[
                ["Eligible Voters", turnoutMetricValue(turnoutSummary, "eligible_voters"), "Members in the locked election electorate"],
                ["Voters Participated", turnoutMetricValue(turnoutSummary, "participated_voters"), "Distinct submitted ballots"],
                ["Voter Turnout", formatTurnoutPercentage(turnoutSummary), turnoutAvailabilityLabel(turnoutSummary)],
                ["Abstentions", analytics.totalAbstains, "Recorded abstain selections across positions"],
              ].map(([label, value, hint]) => (
                <div key={label} className="border-t border-black/10 pt-3">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">{label}</p>
                  <h2 className="mt-2 font-serif text-5xl font-bold tracking-tight">{value}</h2>
                  <p className="mt-3 text-sm text-gray-500">{hint}</p>
                </div>
              ))}
            </div>

            <section className="results-chapter">
              <div className="results-chapter-head">
                <span className="results-chapter-index">01</span>
                <span className="results-chapter-label">Official Tally</span>
              </div>
              <ElectionResultsChart
                groups={Object.values(analytics.groupedResults)}
                totalVoters={turnoutSummary?.participated_voters ?? analytics.totalUniqueVoters}
                dimensions={analytics.resultDimensions}
                presentation="editorial"
              />
            </section>

            <section className="results-chapter">
              <div className="results-chapter-head">
                <span className="results-chapter-index">02</span>
                <span className="results-chapter-label">Voter Breakdown</span>
              </div>
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
                presentation="editorial"
              />
            </section>

            <section className="results-chapter">
              <div className="results-chapter-head">
                <span className="results-chapter-index">03</span>
                <span className="results-chapter-label">Election Record</span>
              </div>
              <div className="results-chapter-record">
                <h3 className="font-serif text-xl font-bold leading-tight text-gray-900">
                  Current and previous results
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                  Result summaries stay available for older elections in the same
                  selection list, so you can compare turnout and demographic allocation
                  across election cycles.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default StudentResults;
