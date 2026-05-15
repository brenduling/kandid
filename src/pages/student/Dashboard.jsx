import { useEffect, useState } from "react";
import { Eye, Vote } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import {
  canStudentViewResults,
  formatLocalDateTime,
  getElectionPhase,
} from "../../utils/elections";

function StudentDashboard() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
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

      if (!active) return;

      setElections(electionData || []);
      setLoading(false);
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [user.id]);

  return (
    <div>
      <div className="page-head">
        <div>
        <div className="page-kicker">Student Overview</div>
        <h1 className="page-title">Welcome back</h1>
        <p className="page-subtitle">
          Review campaign periods, vote on time, and check results when available.
        </p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">Loading...</div>
      ) : (
        <div className="section-grid grid-cols-1 xl:grid-cols-3">
          {elections.length === 0 ? (
            <div className="empty-state col-span-3">No elections available.</div>
          ) : (
            elections.map((election) => {
              const phase = getElectionPhase(election);

              return (
                <div
                  key={election.id}
                  className="glass-panel-strong lift-card flex flex-col justify-between rounded-[28px] p-6"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff7a35]">
                          {election.organizations?.name || "Organization"}
                        </p>
                        <h2 className="mt-2 text-xl font-black text-[#1d262f]">{election.title}</h2>
                      </div>
                      <span className="status-pill">
                        {phase}
                      </span>
                    </div>

                    <p className="mt-4 text-sm text-[#5a5548]">
                      Voting starts: {formatLocalDateTime(election.start_date)}
                    </p>
                  </div>

                  <div className="mt-6">
                    {phase === "campaign" ? (
                      <button
                        onClick={() =>
                          navigate(`/student/elections/${election.id}/campaign`)
                        }
                        className="secondary-btn w-full"
                      >
                        <Eye size={18} />
                        Open Campaign Module
                      </button>
                    ) : phase === "voting" ? (
                      <button
                        onClick={() => navigate(`/student/vote/${election.id}`)}
                        className="primary-btn w-full"
                      >
                        <Vote size={18} />
                        Vote Now
                      </button>
                    ) : canStudentViewResults(election) ? (
                      <button
                        onClick={() =>
                          navigate(`/student/results?election=${election.id}`)
                        }
                        className="primary-btn w-full"
                      >
                        <Eye size={18} />
                        View Results
                      </button>
                    ) : (
                        <div className="rounded-2xl bg-white/50 px-4 py-3 text-sm font-semibold text-[#5a5548]">
                          Waiting for the next phase.
                        </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;
