import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Binary, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";
import { useEffect } from "react";

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "super_admin") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("admin_users")
      .select("id, email, password, full_name, role, status, created_at")
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

    if (data.role !== "super_admin") {
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

    // redirect
    navigate("/super-admin/dashboard", { replace: true });

    setLoading(false);
  }

  return (
    <div className="auth-screen">
      <div className="ambient-orb left-[-120px] top-14 h-96 w-96 bg-[rgba(37,99,235,0.16)]" />
      <div className="ambient-orb bottom-6 right-[-80px] h-80 w-80 bg-[rgba(34,211,238,0.14)]" />

      <div className="auth-grid">
        <section className="auth-shell fade-up hidden lg:block">
          <div className="page-kicker">
            <Binary size={14} />
            Blockchain E-Voting Core
          </div>
          <h1 className="page-title mt-6 max-w-3xl text-5xl">
            Super admin access for a
            <span className="page-title-accent"> secure governance stack</span>
          </h1>
          <p className="page-subtitle mt-5 max-w-2xl text-base">
            Control organizations, election rules, result visibility, board access,
            and blockchain verification from one high-trust command center.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              ["System governance", "Manage all organizations, elections, and user permissions."],
              ["Verification layer", "Review vote receipts, audit logs, and blockchain-linked records."],
              ["Security posture", "Operate with role-based access and controlled election states."],
              ["Production-ready UX", "Designed for modern institutional election management."],
            ].map(([title, copy], index) => (
              <div key={title} className="auth-feature">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#7ddff3]">
                  {index % 2 === 0 ? <ShieldCheck size={18} /> : <Sparkles size={18} />}
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
                Super Admin Login
              </div>
              <h2 className="surface-title mt-4 text-3xl font-black">KANDID Control</h2>
              <p className="surface-copy mt-2 text-sm leading-6">
                Sign in to manage system-wide election operations and security settings.
              </p>
            </div>
            <div className="hidden h-16 w-16 items-center justify-center rounded-[22px] bg-[rgba(37,99,235,0.16)] text-[#7ddff3] sm:flex">
              <ShieldCheck size={28} />
            </div>
          </div>

          <div className="mt-8 space-y-5">
            <div>
              <label className="field-label">Admin Email</label>
              <input
                type="email"
                placeholder="Enter super admin email"
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
              {loading ? "Authenticating..." : "Access Super Admin Console"}
            </button>
          </div>

          <div className="mt-6 rounded-[24px] border border-[rgba(255,115,22,0.12)] bg-white/30 px-4 py-4">
            <p className="surface-muted text-xs font-bold uppercase tracking-[0.18em]">
              Security Notice
            </p>
            <p className="surface-copy mt-2 text-sm leading-6">
              Restricted institutional access. Authorized governance personnel only.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
