import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, LockKeyhole, ShieldCheck, Vote } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";
import { useEffect } from "react";

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "student") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("student_number", studentNumber)
      .single();

    if (error || !data) {
      alert("Student not found. Contact your organization.");
      setLoading(false);
      return;
    }

    // 🚨 STATUS LOGIC
    if (data.status === "pending") {
      alert("Please complete your account setup first.");
      navigate("/student-setup", { replace: true });
      setLoading(false);
      return;
    }

    if (data.status === "disabled") {
      alert("Your account is disabled.");
      setLoading(false);
      return;
    }

    // 🔐 PASSWORD CHECK
    if (data.password !== password) {
      alert("Incorrect password.");
      setLoading(false);
      return;
    }

    // ✅ LOGIN SUCCESS
    const studentSession = {
      ...data,
      role: "student",
    };

    localStorage.setItem("user", JSON.stringify(studentSession));

    navigate("/student/dashboard", { replace: true });
    setLoading(false);
  }

  return (
    <div className="auth-screen">
      <div className="ambient-orb left-[-90px] top-16 h-80 w-80 bg-[rgba(34,211,238,0.16)]" />
      <div className="ambient-orb bottom-10 right-[-80px] h-72 w-72 bg-[rgba(37,99,235,0.14)]" />

      <div className="auth-grid">
        <section className="auth-shell fade-up hidden lg:block">
          <div className="page-kicker">
            <Vote size={14} />
            Student Voting Portal
          </div>
          <h1 className="page-title mt-6 max-w-3xl text-5xl">
            Participate in elections with
            <span className="page-title-accent"> secure digital trust</span>
          </h1>
          <p className="page-subtitle mt-5 max-w-2xl text-base">
            Review campaigns, enter controlled ballots, receive verification
            receipts, and follow results from a clean mobile-friendly student experience.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              ["Campaign preview", "Explore candidate platforms and credentials before voting begins."],
              ["Secure ballot", "Vote only during valid windows with optional QR or location controls."],
              ["Receipt trail", "Keep verification hashes for every completed submission."],
              ["Results visibility", "See published tallies only when election settings allow it."],
            ].map(([title, copy], index) => (
              <div key={title} className="auth-feature">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#7ddff3]">
                  {index % 2 === 0 ? <GraduationCap size={18} /> : <ShieldCheck size={18} />}
                </div>
                <p className="text-sm font-black text-white">{title}</p>
                <p className="mt-2 text-sm leading-6 text-white/64">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={handleLogin} className="auth-card fade-up mx-auto w-full max-w-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="secure-badge">
                <LockKeyhole size={14} />
                Student Login
              </div>
              <h2 className="surface-title mt-4 text-3xl font-black">KANDID Student Access</h2>
              <p className="surface-copy mt-2 text-sm leading-6">
                Sign in to vote, verify your ballots, and follow election activity.
              </p>
            </div>
            <div className="hidden h-16 w-16 items-center justify-center rounded-[22px] bg-[rgba(37,99,235,0.16)] text-[#7ddff3] sm:flex">
              <GraduationCap size={28} />
            </div>
          </div>

          <div className="mt-8 space-y-5">
            <div>
              <label className="field-label">Student Number</label>
              <input
                type="text"
                placeholder="Enter student number"
                required
                value={studentNumber}
                onChange={(e) => setStudentNumber(e.target.value)}
                className="field-shell w-full"
              />
            </div>

            <div>
              <label className="field-label">Password</label>
              <input
                type="password"
                placeholder="Enter password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-shell w-full"
              />
            </div>

            <button disabled={loading} className="primary-btn w-full">
              {loading ? "Authenticating..." : "Enter Student Portal"}
            </button>
          </div>

          <div className="mt-5 text-center text-sm">
            <button
              type="button"
              onClick={() => navigate("/student-setup")}
              className="font-semibold text-[#8fe9f7] hover:underline"
            >
              First time here? Complete account setup
            </button>
          </div>

          <div className="mt-6 rounded-[24px] border border-[rgba(255,115,22,0.12)] bg-white/30 px-4 py-4">
            <p className="surface-muted text-xs font-bold uppercase tracking-[0.18em]">
              Student Access Notice
            </p>
            <p className="surface-copy mt-2 text-sm leading-6">
              Only registered students with active organization-linked accounts can access the portal.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StudentLogin;
