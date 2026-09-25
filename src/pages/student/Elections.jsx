import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ElectionCover from "../../components/ElectionCover";
import { OrganizationLogo } from "../../components/KandidImage";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  compareElectionScheduleValues,
  formatLocalDateTime,
  formatScheduleRange,
  getElectionPhase,
  getElectionLocationLabel,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { isMissingResultReleaseColumn } from "../../utils/results";

function friendlyPhase(phase) {
  if (phase === "campaign_upcoming") return "Campaign Upcoming";
  if (phase === "campaign") return "Campaign Period";
  if (phase === "waiting") return "Waiting for Election";
  if (phase === "voting") return "Voting Open";
  if (phase === "closed") return "Closed";
  if (phase === "draft") return "Draft";
  return "Upcoming";
}

function phasePresentation(election, voted) {
  const phase = getElectionPhase(election);
  const resultsAvailable = canStudentViewResults(election);

  if (phase === "campaign_upcoming") {
    return {
      label: "Upcoming",
      tone: "upcoming",
      summary: "Campaign information will be available when the campaign period begins.",
      nextLabel: "Campaign opens",
      nextValue: formatLocalDateTime(election.campaign_start),
    };
  }

  if (phase === "campaign") {
    return {
      label: "Campaign period",
      tone: "campaign",
      summary: "The campaign period is open. Review the election before voting begins.",
      nextLabel: "Campaign closes",
      nextValue: formatLocalDateTime(election.campaign_end),
    };
  }

  if (phase === "waiting") {
    return {
      label: "Voting next",
      tone: "waiting",
      summary: "Campaigning has ended. Your ballot will open at the scheduled voting time.",
      nextLabel: "Voting opens",
      nextValue: formatLocalDateTime(election.start_date),
    };
  }

  if (phase === "voting" && voted) {
    return {
      label: "Ballot submitted",
      tone: "recorded",
      summary: "Your ballot is already recorded. Your choices are not shown here.",
      nextLabel: "Voting closes",
      nextValue: formatLocalDateTime(election.end_date),
    };
  }

  if (phase === "voting") {
    return {
      label: "Voting open",
      tone: "voting",
      summary: "Your ballot is available now. Review every position before submitting.",
      nextLabel: "Voting closes",
      nextValue: formatLocalDateTime(election.end_date),
    };
  }

  if (resultsAvailable) {
    return {
      label: "Results available",
      tone: "results",
      summary: "Results are available to students.",
      nextLabel: "Voting closed",
      nextValue: formatLocalDateTime(election.end_date),
    };
  }

  if (phase === "closed") {
    return {
      label: "Election closed",
      tone: "closed",
      summary: "Voting has ended. Results will appear when released.",
      nextLabel: "Results",
      nextValue: "Awaiting publication",
    };
  }

  return {
    label: friendlyPhase(phase),
    tone: "upcoming",
    summary: "This election is not open for participation yet.",
    nextLabel: "Voting opens",
    nextValue: formatLocalDateTime(election.start_date),
  };
}

const electionColumnsWithRelease = `
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  voting_access_mode,
  location_label,
  student_result_visibility,
  results_released_at,
  organizations(name, logo_url)
`;

const electionColumnsWithoutRelease = `
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  voting_access_mode,
  location_label,
  student_result_visibility,
  organizations(name, logo_url)
`;

function electionColumns(includeReleaseColumn, includeCoverColumn = true) {
  const columns = includeReleaseColumn
    ? electionColumnsWithRelease
    : electionColumnsWithoutRelease;

  return includeCoverColumn ? columns : columns.replace(/\n\s*cover_url,\n/, "\n");
}

async function fetchVoteStatus(
  studentId,
  includeReleaseColumn = true,
  includeCoverColumn = true,
) {
  const { data, error } = await supabase
    .from("votes")
    .select(`
      election_id,
      elections (
        ${electionColumns(includeReleaseColumn, includeCoverColumn)}
      )
    `)
    .eq("student_id", studentId);

  return {
    data: (data || []).map((voteRow) => ({
      ...voteRow,
      elections: voteRow.elections
        ? {
            ...voteRow.elections,
            results_released_at: voteRow.elections.results_released_at || null,
          }
        : null,
    })),
    error,
  };
}

function StudentElections() {
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchQuery = (searchParams.get("q") || "").trim().toLowerCase();

  useEffect(() => {
    let active = true;

    async function loadElections() {
      setLoading(true);
      setLoadError("");

      const organizationIds = await getStudentElectionOrganizationIds(user);
      let includeReleaseColumn = true;
      let includeCoverColumn = true;
      let voteResponse = await fetchVoteStatus(
        user.id,
        includeReleaseColumn,
        includeCoverColumn,
      );

      if (isMissingResultReleaseColumn(voteResponse.error)) {
        includeReleaseColumn = false;
        voteResponse = await fetchVoteStatus(user.id, includeReleaseColumn, includeCoverColumn);
      }

      if (isMissingElectionCoverColumn(voteResponse.error)) {
        includeCoverColumn = false;
        voteResponse = await fetchVoteStatus(user.id, includeReleaseColumn, includeCoverColumn);
      }

      if (voteResponse.error) {
        console.error("Failed to load student voting status:", voteResponse.error);
        if (active) {
          setLoadError(voteResponse.error.message || "Unable to load your voting status.");
          setElections([]);
          setVotes([]);
          setLoading(false);
        }
        return;
      }

      const voteData = voteResponse.data || [];

      const votedElectionIds = [
        ...new Set(
          (voteData || [])
            .map((voteRow) => voteRow.election_id)
            .filter(Boolean)
        ),
      ];

      if (organizationIds.length === 0 && votedElectionIds.length === 0) {
        if (active) {
          setElections([]);
          setVotes([]);
          setLoading(false);
        }
        return;
      }

      const tionQueries = (
        nextIncludeReleaseColumn = includeReleaseColumn,
        nextIncludeCoverColumn = includeCoverColumn,
      ) => {
        const queries = [];

        if (organizationIds.length > 0) {
          queries.push(
            supabase
              .from("elections")
              .select(electionColumns(nextIncludeReleaseColumn, nextIncludeCoverColumn))
              .in("organization_id", organizationIds)
              .neq("status", "draft")
              .neq("status", "archived")
              .order("start_date", { ascending: false })
          );
        }

        if (votedElectionIds.length > 0) {
          queries.push(
            supabase
              .from("elections")
              .select(electionColumns(nextIncludeReleaseColumn, nextIncludeCoverColumn))
              .in("id", votedElectionIds)
              .neq("status", "draft")
              .neq("status", "archived")
              .order("start_date", { ascending: false })
          );
        }

        return queries;
      };

      let electionResponses = await Promise.all(tionQueries());

      if (electionResponses.some((response) => isMissingResultReleaseColumn(response.error))) {
        includeReleaseColumn = false;
        electionResponses = await Promise.all(tionQueries(includeReleaseColumn, includeCoverColumn));
      }

      if (electionResponses.some((response) => isMissingElectionCoverColumn(response.error))) {
        includeCoverColumn = false;
        electionResponses = await Promise.all(tionQueries(includeReleaseColumn, includeCoverColumn));
      }

      if (!active) return;

      const electionMap = new Map();

      const electionErrors = [];

      electionResponses.forEach(({ data, error }) => {
        if (error) {
          console.error("Failed to load student election overview:", error);
          electionErrors.push(error);
        }

        (data || []).forEach((election) => {
          electionMap.set(election.id, {
            ...election,
            results_released_at: election.results_released_at || null,
          });
        });
      });

      if (electionErrors.length > 0) {
        setLoadError(
          electionErrors[0].message ||
            "Unable to load elections for your account.",
        );
        setElections([]);
        setVotes(voteData || []);
        setLoading(false);
        return;
      }

      (voteData || []).forEach((voteRow) => {
        const election = voteRow.elections;
        if (election && election.status !== "draft" && election.status !== "archived") {
          electionMap.set(election.id, election);
        }
      });

      setElections(
        [...electionMap.values()].sort(
          (first, second) =>
            compareElectionScheduleValues(second.start_date, first.start_date)
        )
      );
      setVotes(voteData || []);
      setLoading(false);
    }

    loadElections();

    return () => {
      active = false;
    };
  }, [user.id, reloadKey]);

  function hasVoted(electionId) {
    return votes.some((voteRow) => voteRow.election_id === electionId);
  }

  function actionFor(election) {
    const phase = getElectionPhase(election);

    if (phase === "campaign") {
      return (
        <button
          type="button"
          onClick={() => navigate(`/student/elections/${election.id}/campaign`)}
          className="student-election-action student-participation-action"
        >
          View Campaign
          <ArrowRight size={15} />
        </button>
      );
    }

    if (phase === "voting" && !hasVoted(election.id)) {
      return (
        <button
          type="button"
          onClick={() => navigate(`/student/vote/${election.id}`)}
          className="student-election-action student-participation-action"
        >
          Vote Now
          <ArrowRight size={15} />
        </button>
      );
    }

    if (phase === "voting") {
      return (
        <div className="student-participation-recorded">
          <span>
            <strong>Ballot submitted</strong>
            Your vote is recorded in Kandid.
          </span>
        </div>
      );
    }

    if (canStudentViewResults(election)) {
      return (
        <div className="student-participation-actions">
          <button
            type="button"
            onClick={() => navigate(`/student/elections/${election.id}/campaign`)}
            className="student-outline-btn student-participation-secondary-action"
          >
            View Campaign
          </button>
          <button
            type="button"
            onClick={() => navigate(`/student/results?election=${election.id}`)}
            className="student-election-action student-participation-action"
          >
            View Results
            <ArrowRight size={15} />
          </button>
        </div>
      );
    }

    return (
      <div className="student-participation-unavailable">
        {phase === "campaign_upcoming"
          ? `Campaign begins ${formatLocalDateTime(election.campaign_start)}.`
          : phase === "waiting"
          ? `Voting opens ${formatLocalDateTime(election.start_date)}.`
          : "Voting is not currently available."}
      </div>
    );
  }

  const filteredElections = useMemo(() => {
    if (!searchQuery) return elections;

    return elections.filter((election) => {
      const values = [
        election.title,
        election.organizations?.name,
        election.status,
        friendlyPhase(getElectionPhase(election)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return values.includes(searchQuery);
    });
  }, [elections, searchQuery]);

  return (
    <div className="student-elections-desktop">
      <header className="student-elections-opening">
        <div className="student-elections-opening-copy">
          <span className="student-elections-kicker">Your election path</span>
          <h1>Elections that matter to you.</h1>
          <p>
            See what is happening now, what you can do, and when the next step begins.
          </p>
        </div>
      </header>

      {loading ? (
        <StudentSkeletonGroup label="Loading elections">
          <div className="student-participation-list">
            {[0, 1].map((index) => (
              <div className="student-skeleton-row" key={index}>
                <StudentSkeletonLine
                  variant="media"
                  width="3rem"
                  height="3rem"
                />

                <div className="student-skeleton-copy">
                  <StudentSkeletonLine width="38%" height="0.6rem" />
                  <StudentSkeletonLine width="76%" height="1rem" />
                  <StudentSkeletonLine width="28%" height="0.6rem" />
                  <StudentSkeletonLine width="92%" height="0.65rem" />
                  <StudentSkeletonLine width="64%" height="0.65rem" />
                  <StudentSkeletonLine width="34%" height="0.85rem" />
                </div>
              </div>
            ))}
          </div>
        </StudentSkeletonGroup>
      ) : loadError ? (
        <div className="student-empty-card student-elections-state">
          <div className="space-y-3">
            <p className="font-bold text-rose-600">Unable to load elections.</p>
            <p className="text-sm text-gray-500">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((current) => current + 1)}
              className="student-outline-btn"
            >
              Retry
            </button>
          </div>
        </div>
      ) : filteredElections.length === 0 ? (
        <div className="student-empty-card student-elections-state">
          {searchQuery
            ? "No elections match your search."
            : "No elections available for your account."}
        </div>
      ) : (
        <section className="student-elections-list" aria-label="Available elections">
          <div className="student-elections-list-head">
            <div>
              <span className="student-elections-kicker">Participation</span>
              <h2>Your elections</h2>
            </div>
            <span>
              {filteredElections.length}{" "}
              {filteredElections.length === 1 ? "Election" : "Elections"}
            </span>
          </div>

          <div className="student-participation-list">
            {filteredElections.map((election, index) => {
              const voted = hasVoted(election.id);
              const presentation = phasePresentation(election, voted);
              const showActions = ["campaign", "voting", "results"].includes(
                presentation.tone
              );

              return (
                <article key={election.id} className="student-participation-card">
                  <div className="student-participation-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </div>

                  <figure className="student-participation-media">
                    {election.cover_url ? (
                      <ElectionCover election={election} compact />
                    ) : (
                      <div className="student-participation-fallback">
                        <OrganizationLogo
                          organization={election.organizations}
                          className="student-participation-fallback-logo"
                        />
                      </div>
                    )}
                  </figure>

                  <div className="student-participation-main">
                    <div className="student-participation-organization">
                      <OrganizationLogo
                        organization={election.organizations}
                        className="student-participation-logo"
                      />
                      <span>{election.organizations?.name || "Student Organization"}</span>
                    </div>

                    <h2 className="student-participation-title">{election.title}</h2>

                    <div className="student-participation-status">
                      <span
                        className={`student-participation-state-mark is-${presentation.tone}`}
                        aria-hidden="true"
                      />
                      <span className={`student-participation-phase is-${presentation.tone}`}>
                        {presentation.label}
                      </span>
                    </div>

                    <p className="student-participation-summary">{presentation.summary}</p>

                    <details className="student-participation-schedule-details">
                      <summary>Schedule</summary>
                    </details>
                    <dl className="student-participation-schedule">
                      <div>
                        <dt>Campaign</dt>
                        <dd>{formatScheduleRange(election.campaign_start, election.campaign_end)}</dd>
                      </div>
                      <div>
                        <dt>Voting</dt>
                        <dd>{formatScheduleRange(election.start_date, election.end_date)}</dd>
                      </div>
                      <div>
                        <dt>Access</dt>
                        <dd>{getElectionLocationLabel(election)}</dd>
                      </div>
                    </dl>

                    {showActions ? (
                      <div className="student-participation-next">
                        {actionFor(election)}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default StudentElections;
