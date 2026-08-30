import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, CheckCircle, Clock3, Info, MapPin, Vote } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KandidInlineLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  compareElectionScheduleValues,
  formatLocalDateTime,
  getElectionPhase,
  getElectionLocationLabel,
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

const electionColumnsWithRelease = `
  id,
  title,
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
  organizations(name)
`;

const electionColumnsWithoutRelease = `
  id,
  title,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  voting_access_mode,
  location_label,
  student_result_visibility,
  organizations(name)
`;

function electionColumns(includeReleaseColumn) {
  return includeReleaseColumn ? electionColumnsWithRelease : electionColumnsWithoutRelease;
}

async function fetchVoteStatus(studentId, includeReleaseColumn = true) {
  const { data, error } = await supabase
    .from("votes")
    .select(`
      election_id,
      elections (
        ${electionColumns(includeReleaseColumn)}
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
      let voteResponse = await fetchVoteStatus(user.id);

      if (isMissingResultReleaseColumn(voteResponse.error)) {
        voteResponse = await fetchVoteStatus(user.id, false);
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

      const buildElectionQueries = (includeReleaseColumn = true) => {
        const queries = [];

        if (organizationIds.length > 0) {
          queries.push(
            supabase
              .from("elections")
              .select(electionColumns(includeReleaseColumn))
              .in("organization_id", organizationIds)
              .neq("status", "draft")
              .neq("status", "archived")
              .order("start_date", { ascending: true })
          );
        }

        if (votedElectionIds.length > 0) {
          queries.push(
            supabase
              .from("elections")
              .select(electionColumns(includeReleaseColumn))
              .in("id", votedElectionIds)
              .neq("status", "draft")
              .neq("status", "archived")
              .order("start_date", { ascending: true })
          );
        }

        return queries;
      };

      let electionResponses = await Promise.all(buildElectionQueries());

      if (electionResponses.some((response) => isMissingResultReleaseColumn(response.error))) {
        electionResponses = await Promise.all(buildElectionQueries(false));
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
            compareElectionScheduleValues(first.start_date, second.start_date)
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
          onClick={() => navigate(`/student/elections/${election.id}/campaign`)}
          className="student-election-action"
        >
          Overview
        </button>
      );
    }

    if (phase === "voting" && !hasVoted(election.id)) {
      return (
        <button
          onClick={() => navigate(`/student/vote/${election.id}`)}
          className="student-election-action"
        >
          Vote Now
        </button>
      );
    }

    if (phase === "voting") {
      return (
        <div className="student-election-note student-election-note-green">
          <CheckCircle size={16} />
          Already voted.
        </div>
      );
    }

    if (canStudentViewResults(election)) {
      return (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate(`/student/elections/${election.id}/campaign`)}
            className="student-election-action"
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => navigate(`/student/results?election=${election.id}`)}
            className="student-election-action"
          >
            View Results
          </button>
        </div>
      );
    }

    return (
      <div className="student-election-note">
        <Info size={16} />
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
    <div>
      <div className="student-module-banner">
        <div className="student-module-icon">
          <BarChart3 size={22} />
        </div>
        <div>
          <h1>Election Overview</h1>
          <p>View and manage ongoing and upcoming elections.</p>
        </div>
      </div>

      {loading ? (
        <div className="student-empty-card">
          <KandidInlineLoader message="Loading elections..." />
        </div>
      ) : loadError ? (
        <div className="student-empty-card">
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
        <div className="student-empty-card">
          {searchQuery
            ? "No elections match your search."
            : "No elections available for your account."}
        </div>
      ) : (
        <div className="student-election-grid">
          {filteredElections.map((election) => {
            const phase = getElectionPhase(election);

            return (
              <article key={election.id} className="student-election-card">
                <div className="student-election-art" />
                <h2>{election.title}</h2>
                <span className="student-election-status">
                  Status: {friendlyPhase(phase)}
                </span>

                <div className="student-election-meta">
                  <p>
                    <CalendarDays size={16} />
                    Campaign Date: {formatLocalDateTime(election.campaign_start)}
                  </p>
                  <p>
                    <CalendarDays size={16} />
                    Election Date: {formatLocalDateTime(election.start_date)}
                  </p>
                  <p>
                    <Clock3 size={16} />
                    Time: {formatLocalDateTime(election.start_date)} -{" "}
                    {formatLocalDateTime(election.end_date)}
                  </p>
                  <p>
                    <MapPin size={16} />
                    Venue: {getElectionLocationLabel(election)}
                  </p>
                </div>

                <div className="student-election-note">
                  <Vote size={16} />
                  Eligible students can review candidates and vote during active
                  election windows.
                </div>

                {actionFor(election)}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StudentElections;
