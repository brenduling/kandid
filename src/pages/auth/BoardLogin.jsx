import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, QrCode, ShieldCheck, Users } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";
import { useEffect } from "react";

function BoardLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "electoral_board") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("admin_users")
      .select(`
        id,
        email,
        password,
        full_name,
        role,
        status,
        organization_id,
        created_at,
        organizations (
          id,
          name
        )
      `)
      .eq("email", email)
      .single();

    if (error || !data) {
      alert("Invalid email");
      setLoading(false);
      return;
    }

    if (data.password !== password) {
      alert("Incorrect password");
      setLoading(false);
      return;
    }

    if (data.role !== "electoral_board") {
      alert("Unauthorized access");
      setLoading(false);
      return;
    }

    if (data.status !== "active") {
      alert("Account is disabled");
      setLoading(false);
      return;
    }

    // save session
    localStorage.setItem("user", JSON.stringify(data));

    // redirect to board panel
    navigate("/board/dashboard", { replace: true });

    setLoading(false);
  }

  return (
    <div className="auth-screen">
      <div className="ambient-orb left-[-90px] top-24 h-80 w-80 bg-[rgba(34,211,238,0.14)]" />
      <div className="ambient-orb bottom-8 right-[-90px] h-96 w-96 bg-[rgba(37,99,235,0.16)]" />

      <div className="auth-grid">
        <section className="auth-shell fade-up hidden lg:block">
          <div className="page-kicker">
            <ShieldCheck size={14} />
            Electoral Board Workspace
          </div>
          <h1 className="page-title mt-6 max-w-3xl text-5xl">
            Operational access for
            <span className="page-title-accent"> monitored election control</span>
          </h1>
          <p className="page-subtitle mt-5 max-w-2xl text-base">
            Oversee candidate management, precinct voting rules, QR access gates,
            turnout, and results from a secure board-specific environment.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              ["Election workflow", "Open campaigns, positions, candidates, and managed voting windows."],
              ["Board monitoring", "Track voting readiness, access control, and operational status."],
              ["QR access support", "Generate scoped voting tokens per precinct, batch, or supervised entry."],
              ["Audit visibility", "Review structured records with cleaner oversight and traceability."],
            ].map(([title, copy], index) => (
              <div key={title} className="auth-feature">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#7ddff3]">
                  {index % 2 === 0 ? <Users size={18} /> : <QrCode size={18} />}
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
                Electoral Board Login
              </div>
              <h2 className="surface-title mt-4 text-3xl font-black">KANDID Board Access</h2>
              <p className="surface-copy mt-2 text-sm leading-6">
                Sign in to manage election operations for your assigned organization.
              </p>
            </div>
            <div className="hidden h-16 w-16 items-center justify-center rounded-[22px] bg-[rgba(37,99,235,0.16)] text-[#7ddff3] sm:flex">
              <Users size={28} />
            </div>
          </div>

          <div className="mt-8 space-y-5">
            <div>
              <label className="field-label">Board Email</label>
              <input
                type="email"
                placeholder="Enter electoral board email"
                required
                className="field-shell w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Password</label>
              <input
                type="password"
                placeholder="Enter password"
                required
                className="field-shell w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" disabled={loading} className="primary-btn w-full">
              {loading ? "Authenticating..." : "Enter Board Workspace"}
            </button>
          </div>

          <div className="mt-6 rounded-[24px] border border-[rgba(255,115,22,0.12)] bg-white/30 px-4 py-4">
            <p className="surface-muted text-xs font-bold uppercase tracking-[0.18em]">
              Restricted Role
            </p>
            <p className="surface-copy mt-2 text-sm leading-6">
              Access is limited to authorized electoral board personnel assigned to an organization.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BoardLogin;
