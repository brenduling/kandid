import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import logo from "../../assets/kandidlogo.png";
import { KandidMascot } from "../../components/KandidMascot";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import {
  getDefaultRouteForUser,
  getStoredUser,
  isSupabaseAdminAuthMode,
  linkCurrentAdminIdentity,
  requireAdminRole,
  signOutAdminSession,
} from "../../utils/auth";
import "./AdminLogin.css";

const INVALID_CREDENTIALS = "We couldn't sign you in. Check your Admin email and password and try again.";
const ACCESS_UNAVAILABLE = "This account can't enter the Super Admin workspace. Contact your Kandid administrator.";
const NETWORK_UNAVAILABLE = "We couldn't reach Kandid right now. Check your connection and try again.";
const RETRY_LATER = "Kandid couldn't complete sign-in right now. Try again shortly.";

function temporaryFeedback(error) {
  const status = Number(error?.status || error?.context?.status || 0);
  if (status === 429) return "Too many sign-in attempts. Wait a moment and try again.";
  if (status >= 500) return RETRY_LATER;
  if (!navigator.onLine || error?.name === "AuthRetryableFetchError" || error?.name === "FunctionsFetchError") {
    return NETWORK_UNAVAILABLE;
  }
  return "";
}

function AdminAccessScene() {
  return (
    <svg
      className="admin-login-scene"
      viewBox="0 0 560 400"
      fill="none"
      role="img"
      aria-label="Kandid organizes a system index of organizations, terms, access, and elections."
    >
      <path d="M257 46h232v292H257z" fill="#17181c" />
      <path d="M271 60h204v264H271z" fill="#f8f6f1" />
      <path d="M293 86h82" stroke="#f4512c" strokeWidth="5" />
      <path d="M293 105h155M293 119h112" stroke="#17181c" strokeWidth="2" />
      <path d="M293 145h158M293 195h158M293 245h158M293 295h158" stroke="#bbb5aa" strokeWidth="1.5" />
      <path d="M301 159h18v18h-18zM301 209h18v18h-18zM301 259h18v18h-18zM301 309h18v8h-18z" stroke="#17181c" strokeWidth="1.7" />
      <path d="M336 160h82M336 174h105M336 210h96M336 224h72M336 260h110M336 274h86M336 309h91" stroke="#17181c" strokeWidth="1.8" />
      <path d="M301 159h8M301 209h8M301 259h8M301 309h8" stroke="#f4512c" strokeWidth="2.5" />
      <KandidMascot pose="inspect" x="5" y="95" width="267" height="285" />
    </svg>
  );
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const submittingRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function redirectLinkedSession() {
      if (!isSupabaseAdminAuthMode()) {
        const user = getStoredUser();
        if (active && user?.role === "super_admin") {
          navigate(getDefaultRouteForUser(user), { replace: true });
        }
        return;
      }

      const { data } = await requireAdminRole("super_admin");
      if (active && data) {
        navigate(getDefaultRouteForUser(data), { replace: true });
      }
    }

    redirectLinkedSession();

    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleLogin(event) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setFeedback("");

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        setFeedback(temporaryFeedback(authError) || INVALID_CREDENTIALS);
        return;
      }

      let { data, error } = await requireAdminRole("super_admin");

      if (error || !data) {
        const linkResult = await linkCurrentAdminIdentity();
        if (linkResult.error) {
          await signOutAdminSession();
          setFeedback(temporaryFeedback(linkResult.error) || ACCESS_UNAVAILABLE);
          return;
        }

        const linked = await requireAdminRole("super_admin");
        data = linked.data;
        error = linked.error;
      }

      if (error || !data) {
        await signOutAdminSession();
        setFeedback(temporaryFeedback(error) || ACCESS_UNAVAILABLE);
        return;
      }

      navigate("/super-admin/dashboard", { replace: true });
    } catch (error) {
      setFeedback(temporaryFeedback(error) || RETRY_LATER);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-page">
      <header className="admin-login-header admin-login-canvas">
        <Link to="/admin" className="admin-login-brand" aria-label="Kandid Super Admin landing">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </Link>
        <Link to="/admin" className="admin-login-return">
          Admin home <ArrowLeft size={17} aria-hidden="true" />
        </Link>
      </header>

      <div className="admin-login-workspace admin-login-canvas">
        <section className="admin-login-entry" aria-labelledby="admin-login-title">
          <p className="admin-login-eyebrow">Kandid / Super Admin</p>
          <h1 id="admin-login-title">Admin Login</h1>
          <p className="admin-login-intro">Enter the system workspace.</p>

          <form onSubmit={handleLogin} className="admin-login-form" aria-busy={loading}>
            <div className="admin-login-field">
              <label htmlFor="admin-login-email">Admin Email</label>
              <input
                id="admin-login-email"
                type="email"
                placeholder="Enter your Admin email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setFeedback(""); }}
              />
            </div>

            <div className="admin-login-field">
              <label htmlFor="admin-login-password">Password</label>
              <div className="admin-login-password">
                <input
                  id="admin-login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setFeedback(""); }}
                />
                <button
                  type="button"
                  className="admin-login-visibility"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            {feedback ? (
              <div className="admin-login-feedback" role="alert">
                <AlertCircle size={19} aria-hidden="true" />
                <p>{feedback}</p>
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="admin-login-submit">
              {loading ? <KandidButtonLoader label="Signing in..." /> : <>Enter Admin Workspace <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
            <p className="admin-login-recovery">
              <Link to="/admin-auth/setup?mode=recovery">Forgot password?</Link>
            </p>
          </form>
        </section>

        <aside className="admin-login-aside" aria-label="Kandid system structure">
          <AdminAccessScene />
        </aside>
      </div>
    </main>
  );
}

export default AdminLogin;
