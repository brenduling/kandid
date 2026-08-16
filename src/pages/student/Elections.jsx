import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, CheckCircle, Clock3, Info, MapPin, Vote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  formatLocalDateTime,
  getElectionPhase,
} from "../../utils/elections";

function friendlyPhase(phase) {
  if (phase === "campaign") return "Campaign Period";
  if (phase === "voting") return "Voting Open";
  if (phase === "closed") return "Closed";
  return "Upcoming";
}

function StudentElections() {
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function loadElections() {
      setLoading(true);

      const { data: studentOrgs } = await supabase
        .from("student_organizations")
        .select("organization_id")
        .eq("student_id", user.id);

      const organizationIds = studentOrgs?.map((item) => item.organization_id) || [];

      if (organizationIds.length === 0) {
        if (active) {
          setElections([]);
          setLoading(false);
        }
        return;
      }

      const { data: electionData } = await supabase
        .from("elections")
        .select("*, organizations(name)")
        .in("organization_id", organizationIds)
        .neq("status", "archived")
        .order("start_date", { ascending: true });

      const { data: voteData } = await supabase
        .from("votes")
        .select("election_id")
        .eq("student_id", user.id);

      if (!active) return;

      setElections(electionData || []);
      setVotes(voteData || []);
      setLoading(false);
    }

    loadElections();

    return () => {
      active = false;
    };
  }, [user.id]);

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
        <button
          onClick={() => navigate(`/student/results?election=${election.id}`)}
          className="student-election-action"
        >
          View Results
        </button>
      );
    }

    return (
      <div className="student-election-note">
        <Info size={16} />
        Newly elected officers already active.
      </div>
    );
  }

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
        <div className="student-empty-card">Loading elections...</div>
      ) : elections.length === 0 ? (
        <div className="student-empty-card">No elections available for your account.</div>
      ) : (
        <div className="student-election-grid">
          {elections.map((election) => {
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
                    Venue: {election.venue || "CB 36"}
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
