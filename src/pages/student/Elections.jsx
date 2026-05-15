import { useEffect, useState } from "react";
import { CheckCircle, Eye, Vote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  canStudentViewResults,
  formatLocalDateTime,
  getElectionPhase,
} from "../../utils/elections";

function StudentElections() {
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  function hasVoted(electionId) {
    return votes.some((vote) => vote.election_id === electionId);
  }

  useEffect(() => {
    let active = true;

    async function loadElections() {
      setLoading(true);

      const { data: studentOrgs } = await supabase
        .from("student_organizations")
        .select("organization_id")
        .eq("student_id", user.id);

      const organizationIds =
        studentOrgs?.map((item) => item.organization_id) || [];

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

  function renderPrimaryAction(election) {
    const phase = getElectionPhase(election);
    const alreadyVoted = hasVoted(election.id);

    if (phase === "campaign") {
      return (
        <button
          onClick={() => navigate(`/student/elections/${election.id}/campaign`)}
          className="secondary-btn w-full"
        >
          <Eye size={18} />
          Open Campaign Module
        </button>
      );
    }

    if (phase === "voting") {
      if (alreadyVoted) {
        return (
          <div className="flex items-center gap-2 rounded-2xl bg-[rgba(54,147,111,0.1)] px-4 py-3 font-bold text-green-700">
            <CheckCircle size={18} />
            Already Voted
          </div>
        );
      }

      return (
        <button
          onClick={() => navigate(`/student/vote/${election.id}`)}
          className="primary-btn w-full"
        >
          <Vote size={18} />
          Vote Now
        </button>
      );
    }

    if (canStudentViewResults(election)) {
      return (
        <button
          onClick={() => navigate(`/student/results?election=${election.id}`)}
          className="w-full rounded-2xl bg-[linear-gradient(135deg,#2f8f83,#58b5a7)] px-5 py-3 font-bold text-white shadow-[0_14px_30px_rgba(47,143,131,0.22)]"
        >
          <span className="inline-flex items-center gap-2">
            <Eye size={18} />
            View Results
          </span>
        </button>
      );
    }

    return (
      <div className="rounded-2xl bg-[rgba(29,38,47,0.06)] px-4 py-3 text-sm font-semibold text-gray-600">
        {phase === "closed"
          ? "Results are hidden until the election team publishes them."
          : "Election not yet open."}
      </div>
    );
  }

  const campaignCount = elections.filter(
    (election) => getElectionPhase(election) === "campaign",
  ).length;
  const votingCount = elections.filter(
    (election) => getElectionPhase(election) === "voting",
  ).length;
  const completedCount = votes.length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Election Timeline</div>
          <h1 className="page-title">
            Active student
            <span className="page-title-accent"> election windows</span>
          </h1>
          <p className="page-subtitle">
            Follow the full sequence from campaign preview to voting and result
            publication, with each phase clearly labeled.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          Loading elections...
        </div>
      ) : (
        <>
          <div className="section-grid grid-cols-1 md:grid-cols-3">
            {[
              ["Available Elections", elections.length, "All organization ballots linked to your account"],
              ["Campaigns Open", campaignCount, "Review platforms and credentials before voting"],
              ["Submitted Ballots", completedCount, "Your recorded vote receipts and hashes"],
            ].map(([label, value, hint]) => (
              <div key={label} className="metric-card lift-card">
                <p className="text-sm font-semibold text-gray-500">{label}</p>
                <h2 className="mt-4 text-5xl font-black tracking-tight text-[#1d262f]">{value}</h2>
                <p className="mt-3 text-sm text-gray-500">{hint}</p>
              </div>
            ))}
          </div>

          <div className="section-grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="soft-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8ba4c7]">
                    Voting Focus
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-[#1d262f]">What needs your attention</h3>
                </div>
                <span className="status-pill">
                  {votingCount > 0 ? "Voting live" : "Tracking"}
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  ["Open voting windows", `${votingCount} active now`],
                  ["Campaign review windows", `${campaignCount} available`],
                  ["Completed submissions", `${completedCount} receipts stored`],
                ].map(([label, value]) => (
                  <div key={label} className="info-row">
                    <span className="text-sm font-semibold text-gray-600">{label}</span>
                    <span className="text-sm font-bold text-[#1d262f]">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel-dark rounded-[30px] p-7 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Student Guide
              </p>
              <h3 className="mt-3 text-3xl font-black">Follow the election flow</h3>
              <p className="mt-4 text-sm leading-7 text-white/65">
                Start with campaign materials, vote only during the official window,
                then keep your receipts for verification and follow published results.
              </p>
            </div>
          </div>

          <div className="section-grid grid-cols-1 xl:grid-cols-3">
            {elections.length === 0 ? (
              <div className="empty-state xl:col-span-3">
                No elections available for your account.
              </div>
            ) : (
              elections.map((election, index) => {
                const phase = getElectionPhase(election);

                return (
                  <div
                    key={election.id}
                    className="glass-panel-strong lift-card fade-up rounded-[30px] p-6"
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#2265d8]">
                          {election.organizations?.name || "Organization"}
                        </p>
                        <h2 className="mt-2 text-2xl font-black text-[#1d262f]">{election.title}</h2>
                      </div>
                      <span className="status-pill">{phase}</span>
                    </div>

                    <div className="mt-6 space-y-4 rounded-[24px] bg-white/50 p-4">
                      <div>
                        <p className="field-label !mb-1">Campaign Window Opens</p>
                        <p className="text-sm font-semibold text-[#1d262f]">
                          {formatLocalDateTime(election.campaign_start)}
                        </p>
                      </div>
                      <div>
                        <p className="field-label !mb-1">Voting Starts</p>
                        <p className="text-sm font-semibold text-[#1d262f]">
                          {formatLocalDateTime(election.start_date)}
                        </p>
                      </div>
                      <div>
                        <p className="field-label !mb-1">Voting Ends</p>
                        <p className="text-sm font-semibold text-[#1d262f]">
                          {formatLocalDateTime(election.end_date)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6">{renderPrimaryAction(election)}</div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default StudentElections;
