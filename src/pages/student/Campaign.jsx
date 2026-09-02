import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Trophy,
  UserRound,
  UsersRound,
  Vote,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  OrganizationLogo,
  StudentAvatar,
} from "../../components/KandidImage";
import ElectionCover from "../../components/ElectionCover";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  formatLocalDateTime,
  getElectionPhase,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { isMissingResultReleaseColumn } from "../../utils/results";

const electionSelectWithRelease = `
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  student_result_visibility,
  results_released_at,
  organizations(id, name, description, logo_url, organization_type)
`;

const electionSelectWithoutRelease = `
  id,
  title,
  cover_url,
  organization_id,
  campaign_start,
  campaign_end,
  start_date,
  end_date,
  status,
  student_result_visibility,
  organizations(id, name, description, logo_url, organization_type)
`;

function electionSelect(includeReleaseColumn, includeCoverColumn = true) {
  const columns = includeReleaseColumn
    ? electionSelectWithRelease
    : electionSelectWithoutRelease;

  return includeCoverColumn ? columns : columns.replace(/\n\s*cover_url,\n/, "\n");
}

async function fetchElection(
  electionId,
  includeReleaseColumn = true,
  includeCoverColumn = true,
) {
  const { data, error } = await supabase
    .from("elections")
    .select(electionSelect(includeReleaseColumn, includeCoverColumn))
    .eq("id", electionId)
    .single();

  return {
    data: data ? { ...data, results_released_at: data.results_released_at || null } : null,
    error,
  };
}

function officerName(officer) {
  if (officer?.students) {
    return `${officer.students.first_name || ""} ${officer.students.last_name || ""}`.trim();
  }

  return officer?.officer_name || "Officer";
}

function StudentCampaign() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const [election, setElection] = useState(null);
  const [organizationElections, setOrganizationElections] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [votes, setVotes] = useState([]);
  const [tab, setTab] = useState("officers");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setAccessDenied(false);
      setLoadError("");

      let includeReleaseColumn = true;
      let includeCoverColumn = true;
      const [electionResponse, eligibleOrganizationIds] = await Promise.all([
        fetchElection(electionId, includeReleaseColumn, includeCoverColumn),
        getStudentElectionOrganizationIds(user),
      ]);

      let { data: electionData, error: electionError } = electionResponse;

      if (isMissingResultReleaseColumn(electionError)) {
        includeReleaseColumn = false;
        const fallback = await fetchElection(electionId, includeReleaseColumn, includeCoverColumn);
        electionData = fallback.data;
        electionError = fallback.error;
      }

      if (isMissingElectionCoverColumn(electionError)) {
        includeCoverColumn = false;
        const fallback = await fetchElection(electionId, includeReleaseColumn, includeCoverColumn);
        electionData = fallback.data;
        electionError = fallback.error;
      }

      if (electionError) {
        console.error("Failed to load student election overview:", electionError);
        if (active) {
          setLoadError(electionError.message || "Unable to load election overview.");
          setLoading(false);
        }
        return;
      }

      if (!eligibleOrganizationIds.includes(electionData?.organization_id)) {
        if (active) {
          setAccessDenied(true);
          setLoading(false);
        }
        return;
      }

      const [
        { data: officerData, error: officersError },
        { data: orgElectionData, error: electionsError },
      ] = await Promise.all([
        supabase
          .from("officers")
          .select(`
            *,
            students (
              first_name,
              last_name,
              student_number,
              photo_url,
              program,
              year_level
            )
          `)
          .eq("organization_id", electionData.organization_id)
          .order("is_current", { ascending: false })
          .order("display_order", { ascending: true }),
        supabase
          .from("elections")
          .select("id, title, campaign_start, campaign_end, start_date, end_date, status")
          .eq("organization_id", electionData.organization_id)
          .neq("status", "draft")
          .neq("status", "archived")
          .order("start_date", { ascending: false }),
      ]);

      if (officersError) {
        console.error("Failed to load organization officers:", officersError);
      }

      if (electionsError) {
        console.error("Failed to load organization elections:", electionsError);
      }

      const electionIds = (orgElectionData || []).map((item) => item.id);
      let voteData = [];

      if (electionIds.length > 0) {
        const { data, error } = await supabase
          .from("votes")
          .select(`
            id,
            election_id,
            student_id,
            is_abstain,
            students(program, year_level)
          `)
          .in("election_id", electionIds);

        if (error) {
          console.error("Failed to load organization election demographics:", error);
        } else {
          voteData = data || [];
        }
      }

      if (!active) return;

      setElection(electionData);
      setOfficers(officerData || []);
      setOrganizationElections(orgElectionData || []);
      setVotes(voteData);
      setLoading(false);
    }

    loadOverview();

    return () => {
      active = false;
    };
  }, [electionId, user.id]);

  const officerGroups = useMemo(() => {
    const current = officers.filter((officer) => officer.is_current);
    const past = officers.filter((officer) => !officer.is_current);
    return { current, past };
  }, [officers]);

  const electionDemographics = useMemo(() => {
    if (!election) return [];

    return organizationElections.map((item) => {
      const electionVotes = votes.filter((vote) => vote.election_id === item.id);
      const uniqueVoters = new Set(electionVotes.map((vote) => vote.student_id).filter(Boolean));
      const programCounts = {};

      electionVotes.forEach((vote) => {
        const program = vote.students?.program || "Unspecified";
        programCounts[program] = (programCounts[program] || 0) + 1;
      });

      const topProgram =
        Object.entries(programCounts).sort((first, second) => second[1] - first[1])[0]?.[0] ||
        "No voter data";

      return {
        ...item,
        results_released_at:
          item.id === election.id ? election.results_released_at || null : null,
        student_result_visibility:
          item.id === election.id ? election.student_result_visibility : "manual",
        voteEntries: electionVotes.length,
        uniqueVoters: uniqueVoters.size,
        abstains: electionVotes.filter((vote) => vote.is_abstain).length,
        topProgram,
      };
    });
  }, [election, organizationElections, votes]);

  if (loading) {
    return <div className="student-empty-card">Loading election overview...</div>;
  }

  if (accessDenied) {
    return <div className="student-empty-card">This election overview is not available for your organization.</div>;
  }

  if (loadError) {
    return <div className="student-empty-card">{loadError}</div>;
  }

  if (!election) {
    return <div className="student-empty-card">Election not found.</div>;
  }

  const organization = election.organizations;
  const phase = getElectionPhase(election);

  if (phase === "draft" || phase === "archived") {
    return <div className="student-empty-card">This election overview is not available.</div>;
  }

  if (phase !== "campaign" && !canStudentViewResults(election)) {
    return (
      <div>
        <button type="button" onClick={() => navigate("/student/elections")} className="student-back-link">
          <ArrowLeft size={15} />
          Back
        </button>
        <div className="student-module-banner">
          <div className="student-module-icon">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1>Election Overview</h1>
            <p>
              {phase === "campaign_upcoming"
                ? `Campaign begins ${formatLocalDateTime(election.campaign_start)}.`
                : phase === "waiting"
                  ? `Campaign has ended. Voting opens ${formatLocalDateTime(election.start_date)}.`
                  : "Results are being verified before the overview reopens."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={() => navigate("/student/elections")} className="student-back-link">
        <ArrowLeft size={15} />
        {organization?.name || "Organization"}
      </button>

      <section className="student-campaign-hero student-org-detail-hero">
        {election.cover_url ? (
          <ElectionCover election={election} compact className="student-campaign-cover" />
        ) : (
          <OrganizationLogo
            organization={organization}
            className="!h-[clamp(5.5rem,8vw,8rem)] !w-[clamp(5.5rem,8vw,8rem)] !p-2.5"
            loading="eager"
          />
        )}
        <div>
          <span className="mb-2 inline-flex rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#f4511e]">
            Election Overview
          </span>
          <h1>{organization?.name || "Student Organization"}</h1>
          <p>{election.title}</p>
        </div>
      </section>

      <div className="student-campaign-tabs">
        <button
          type="button"
          className={tab === "officers" ? "active" : ""}
          onClick={() => setTab("officers")}
        >
          Officers
        </button>
        <button
          type="button"
          className={tab === "elections" ? "active" : ""}
          onClick={() => setTab("elections")}
        >
          Elections
        </button>
      </div>

      {tab === "officers" ? (
        <div className="student-officer-stack">
          {officers.length === 0 ? (
            <div className="student-empty-card">No officers have been published for this organization.</div>
          ) : (
            [
              ["Current Officers", officerGroups.current],
              ["Past Officers", officerGroups.past],
            ].map(([title, group]) =>
              group.length > 0 ? (
                <section key={title}>
                  <h2>{title}</h2>
                  <div className="space-y-4">
                    {group.map((officer) => (
                      <div key={officer.id} className="student-officer-row">
                        {officer.students ? (
                          <StudentAvatar student={officer.students} className="student-officer-avatar" />
                        ) : (
                          <div className="student-officer-avatar">
                            <UserRound size={30} />
                          </div>
                        )}
                        <div>
                          <strong>{officerName(officer)}</strong>
                          <p>{officer.position_title || "Officer"}</p>
                          <p>{officer.term_label || (officer.is_current ? "Current Term" : "Past Term")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null,
            )
          )}
        </div>
      ) : (
        <div className="student-org-election-list grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
          {electionDemographics.length === 0 ? (
            <div className="student-empty-card">No organization elections are listed yet.</div>
          ) : (
            electionDemographics.map((item) => (
              <article key={item.id} className="student-org-election-card min-h-[190px]">
                <div>
                  <span className="status-pill">{getElectionPhase(item)}</span>
                  <h2 className="mt-3">{item.title}</h2>
                  <p>{formatLocalDateTime(item.start_date)} - {formatLocalDateTime(item.end_date)}</p>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    [UsersRound, "Voters", item.uniqueVoters],
                    [Vote, "Vote entries", item.voteEntries],
                    [Trophy, "Top program", item.topProgram],
                  ].map(([Icon, label, value]) => (
                    <div key={label} className="rounded-2xl bg-white/70 p-3">
                      <Icon size={16} className="text-[#f4511e]" />
                      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">{label}</p>
                      <strong className="mt-1 block text-sm text-[#182033]">{value}</strong>
                    </div>
                  ))}
                </div>
                {canStudentViewResults(item) ? (
                  <button type="button" onClick={() => navigate(`/student/results?election=${item.id}`)}>
                    View Results
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default StudentCampaign;
