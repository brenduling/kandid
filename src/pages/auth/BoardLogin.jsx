import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import logo from "../../assets/kandidlogo.png";
import { KandidMascot } from "../../components/KandidMascot";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { READ_ONLY_DASHBOARD_MODE } from "../../utils/localProductionReadOnly";
import {
  getDefaultRouteForUser,
  getStoredUser,
  isSupabaseAdminAuthMode,
  linkCurrentAdminIdentity,
  requireAdminRole,
  signOutAdminSession,
} from "../../utils/auth";
import "./BoardLogin.css";

const INVALID_CREDENTIALS = "We couldn't sign you in. Check your Board credentials and try again.";
const ACCESS_UNAVAILABLE = "This account can't enter the Electoral Board workspace. Contact your Kandid administrator.";
const NETWORK_UNAVAILABLE = "We couldn't reach Kandid right now. Check your connection and try again.";
const RETRY_LATER = "Kandid couldn't complete sign-in right now. Try again shortly.";
const RATE_LIMITED = "Too many sign-in attempts. Wait a moment and try again.";
const localProductionReadonly = import.meta.env.MODE === READ_ONLY_DASHBOARD_MODE;

function temporaryFeedback(error) {
  const status = Number(error?.status || error?.context?.status || 0);
  if (status === 429) return RATE_LIMITED;
  if (status >= 500) return RETRY_LATER;
  if (!navigator.onLine || error?.name === "AuthRetryableFetchError" ||
    error?.name === "FunctionsFetchError") return NETWORK_UNAVAILABLE;
  return "";
}

function BoardAccessScene() {
  return (
    <svg
      className="board-login-scene"
      viewBox="0 0 560 400"
      fill="none"
      role="img"
      aria-label="Kandid checks an Electoral Board access sheet."
    >
      <path d="M257 46h232v292H257z" fill="#17181c" />
      <path d="M271 60h204v264H271z" fill="#f8f6f1" />
      <path d="M293 86h82" stroke="#f4512c" strokeWidth="5" />
      <path d="M293 105h155M293 119h112" stroke="#17181c" strokeWidth="2" />
      <path d="M293 145h158M293 195h158M293 245h158" stroke="#bbb5aa" strokeWidth="1.5" />
      <path d="M301 159h18v18h-18zM301 209h18v18h-18zM301 259h18v18h-18z" stroke="#17181c" strokeWidth="2" />
      <path d="M336 160h95M336 174h58M336 210h108M336 224h72M336 260h91M336 274h51" stroke="#17181c" strokeWidth="2" />
      <path d="M293 301h54" stroke="#f4512c" strokeWidth="3" />
      <KandidMascot pose="inspect" x="5" y="95" width="267" height="285" />
    </svg>
  );
}

function BoardLogin() {
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
        if (active && user?.role === "electoral_board") {
          navigate(getDefaultRouteForUser(user), { replace: true });
        }
        return;
      }

      const { data } = await requireAdminRole("electoral_board", {
        requireOrganization: true,
      });
      if (active && data) {
        navigate(getDefaultRouteForUser(data), { replace: true });
      }
    }

    redirectLinkedSession();

    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
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

      let { data, error } = await requireAdminRole("electoral_board", {
        requireOrganization: true,
      });

      if (error || !data) {
        const linkResult = await linkCurrentAdminIdentity();
        if (linkResult.error) {
          const message = temporaryFeedback(linkResult.error) || ACCESS_UNAVAILABLE;
          await signOutAdminSession();
          setFeedback(message);
          return;
        }

        const linked = await requireAdminRole("electoral_board", {
          requireOrganization: true,
        });
        data = linked.data;
        error = linked.error;
      }

      if (error || !data) {
        await signOutAdminSession();
        setFeedback(temporaryFeedback(error) || ACCESS_UNAVAILABLE);
        return;
      }

      navigate("/board/dashboard", { replace: true });
    } catch {
      setFeedback(RETRY_LATER);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="board-login-page">
      <header className="board-login-header board-login-canvas">
        <Link to="/board-portal" className="board-login-brand" aria-label="Kandid Board landing">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </Link>
        <Link to="/board-portal" className="board-login-return">
          Board home <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </header>

      <div className="board-login-workspace board-login-canvas">
        <section className="board-login-entry" aria-labelledby="board-login-title">
          <p className="board-login-eyebrow">Kandid / Electoral Board</p>
          <h1 id="board-login-title">Board Login</h1>
          <p className="board-login-intro">Enter your Board workspace.</p>
          {localProductionReadonly && (
            <p className="mb-5 rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="note">
              Local read-only test connected to production data. Sign-in is enabled; Board writes are blocked in this test mode.
            </p>
          )}

          <form onSubmit={handleLogin} className="board-login-form" aria-busy={loading}>
            <div className="board-login-field">
              <label htmlFor="board-login-email">Board Email</label>
              <input
                id="board-login-email"
                type="email"
                placeholder="Enter your Board email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setFeedback(""); }}
              />
            </div>

            <div className="board-login-field">
              <label htmlFor="board-login-password">Password</label>
              <div className="board-login-password">
                <input
                  id="board-login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setFeedback(""); }}
                />
                <button
                  type="button"
                  className="board-login-visibility"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            {feedback ? (
              <div className="board-login-feedback" role="alert">
                <AlertCircle size={19} aria-hidden="true" />
                <p>{feedback}</p>
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="board-login-submit">
              {loading ? <KandidButtonLoader label="Signing in..." /> : <>Enter Board Workspace <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
            <p className="board-login-recovery">
              <Link to="/admin-auth/setup?mode=recovery">Forgot password?</Link>
            </p>
          </form>
        </section>

        <aside className="board-login-aside" aria-label="Kandid Board access">
          <BoardAccessScene />
        </aside>
      </div>
    </main>
  );
}

export default BoardLogin;
