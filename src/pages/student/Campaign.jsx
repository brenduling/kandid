import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, ChevronRight, UsersRound, Vote } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import KandidImage from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";
import { getStudentElectionOrganizationIds } from "../../utils/organizationAccess";
import { fetchOrderedPositions } from "../../utils/positionOrder";

function StudentCampaign() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [candidateError, setCandidateError] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [tab, setTab] = useState("officers");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const user = JSON.parse(localStorage.getItem("user"));

  function candidateName(candidate) {
    return `${candidate?.students?.first_name || ""} ${candidate?.students?.last_name || ""}`.trim();
  }

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      setLoading(true);
      setAccessDenied(false);
      setCandidateError("");

      const [{ data: electionData }, eligibleOrganizationIds] = await Promise.all([
        supabase
          .from("elections")
          .select(`
            id,
            title,
            organization_id,
            campaign_start,
            campaign_end,
            start_date,
            end_date,
            status,
            organizations(name)
          `)
          .eq("id", electionId)
          .single(),
        getStudentElectionOrganizationIds(user),
      ]);

      if (!eligibleOrganizationIds.includes(electionData?.organization_id)) {
        if (active) {
          setElection(null);
          setPositions([]);
          setCandidates([]);
          setAccessDenied(true);
          setLoading(false);
        }
        return;
      }

      const { data: positionData } = await fetchOrderedPositions(supabase, electionId);

      const positionIds = (positionData || []).map((position) => position.id);
      let candidateData = [];

      if (positionIds.length > 0) {
        const { data, error } = await supabase
          .from("candidates")
          .select(`
            id,
            position_id,
            student_id,
            partylist_id,
            photo,
            credentials,
            bio,
            platform,
            projects,
            students(first_name, last_name, program, year_level, photo_url),
            partylists(name)
          `)
          .in("position_id", positionIds);

        if (error) {
          console.error("Failed to load student campaign candidates:", error);
          if (active) {
            setCandidateError(error.message || "Unable to load candidates.");
          }
        }

        candidateData = data || [];
      }

      if (!active) return;

      setElection(electionData);
      setPositions(positionData || []);
      setCandidates(candidateData);
      setLoading(false);
    }

    loadCampaign();

    return () => {
      active = false;
    };
  }, [electionId, user.id]);

  const groupedCandidates = useMemo(
    () =>
      positions.map((position) => ({
        ...position,
        candidates: candidates.filter((candidate) => candidate.position_id === position.id),
      })),
    [candidates, positions],
  );

  if (loading) {
    return <div className="student-empty-card">Loading campaign...</div>;
  }

  if (accessDenied) {
    return <div className="student-empty-card">This campaign is not available for your organization.</div>;
  }

  if (!election) {
    return <div className="student-empty-card">Election not found.</div>;
  }

  const phase = getElectionPhase(election);

  if (phase === "draft" || phase === "archived") {
    return <div className="student-empty-card">This campaign is not available.</div>;
  }

  if (phase !== "campaign") {
    return (
      <div>
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
                : "Campaign materials are no longer available."}
            </p>
          </div>
        </div>
        <button onClick={() => navigate("/student/elections")} className="student-back-link">
          <ArrowLeft size={15} />
          Back
        </button>
      </div>
    );
  }

  if (selectedCandidate) {
    const position = positions.find((item) => item.id === selectedCandidate.position_id);

    return (
      <div>
        <div className="student-module-banner">
          <div className="student-module-icon">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1>Election Overview</h1>
            <p>View candidate credentials, platforms, and project details.</p>
          </div>
        </div>

        <button onClick={() => setSelectedCandidate(null)} className="student-back-link">
          <ArrowLeft size={15} />
          Back
        </button>

        <select className="student-candidate-select" value={election.organizations?.name || ""} readOnly>
          <option>{election.organizations?.name || "Organization"}</option>
        </select>

        <article className="student-candidate-detail">
          <KandidImage
            src={selectedCandidate.photo || selectedCandidate.students?.photo_url}
            alt={candidateName(selectedCandidate) || "Candidate"}
            label={candidateName(selectedCandidate) || "Candidate"}
            className="student-candidate-photo"
            fit="cover"
          />

          <div className="student-candidate-facts">
            {[
              ["Elected Position:", position?.name || "-"],
              [
                "Full Name:",
                `${selectedCandidate.students?.first_name || ""} ${selectedCandidate.students?.last_name || ""}`.trim() || "-",
              ],
              ["Year Level:", selectedCandidate.students?.year_level || "-"],
              ["Number of Votes:", "Pending election tally"],
              ["Term Started:", formatLocalDateTime(election.start_date)],
              ["Term Finished:", "TBA"],
              ["Party List:", selectedCandidate.partylists?.name || "Independent"],
            ].map(([label, value]) => (
              <p key={label}>
                <Vote size={15} />
                <strong>{label}</strong>
                <span>{value}</span>
              </p>
            ))}
          </div>

          <div className="student-candidate-text-block">
            <h3>Credentials:</h3>
            <p>{selectedCandidate.credentials || selectedCandidate.bio || "No credentials provided."}</p>
          </div>
          <div className="student-candidate-text-block">
            <h3>Platform:</h3>
            <p>{selectedCandidate.platform || "No platform provided."}</p>
          </div>
          <div className="student-candidate-text-block">
            <h3>Projects:</h3>
            <p>{selectedCandidate.projects || "No projects provided."}</p>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => navigate("/student/elections")} className="student-back-link">
        <ArrowLeft size={15} />
        {election.organizations?.name || "Organization"}
      </button>

      <section className="student-campaign-hero">
        <div className="student-campaign-icon">
          <UsersRound size={34} />
        </div>
        <div>
          <h1>{election.organizations?.name || "Student Organization"}</h1>
          <p>{candidates.length} active candidates</p>
          {candidateError ? (
            <p className="mt-2 text-sm font-semibold text-red-600">
              Unable to load candidates. Please retry this campaign page.
            </p>
          ) : null}
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

      {tab === "elections" ? (
        <div className="student-turnout-card">
          <h2>Voter Turnouts</h2>
          <p>{election.title}</p>
          <strong>{formatLocalDateTime(election.start_date)}</strong>
        </div>
      ) : (
        <div className="student-candidate-list">
          {groupedCandidates.map((position) => (
            <section key={position.id}>
              <h2>Candidates for {position.name}</h2>
              <div className="student-candidate-grid">
                {position.candidates.length === 0 ? (
                  <div className="student-empty-card">
                    {candidateError
                      ? "Candidate records could not be loaded for this position."
                      : "No candidates have been added for this position."}
                  </div>
                ) : (
                  position.candidates.map((candidate) => (
                    <article key={candidate.id} className="student-candidate-card">
                      <KandidImage
                        src={candidate.photo || candidate.students?.photo_url}
                        alt={candidateName(candidate) || "Candidate"}
                        label={candidateName(candidate) || "Candidate"}
                        className="student-candidate-avatar"
                        fit="cover"
                      />
                      <div>
                        <h3>
                          {candidate.students?.first_name} {candidate.students?.last_name}
                        </h3>
                        <p>
                          {candidate.students?.program || "Student"} /{" "}
                          {candidate.students?.year_level || "Year Level"}
                        </p>
                        <div className="student-party-card">
                          <span>Partylist</span>
                          <strong>{candidate.partylists?.name || "Independent"}</strong>
                          <span>Platform</span>
                          <strong>{candidate.platform || "No platform provided"}</strong>
                        </div>
                        <button onClick={() => setSelectedCandidate(candidate)}>
                          Read More <ChevronRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default StudentCampaign;
