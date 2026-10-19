import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import StudentCaptcha from "../../components/StudentCaptcha";
import { supabase } from "../../lib/supabaseClient";
import {
  getCurrentAdminProfile,
  getLoginRouteForRole,
  linkCurrentAdminIdentity,
  clearStoredUser,
} from "../../utils/auth";

function getPasswordChecks(password) {
  return [
    { id: "length", label: "6+ chars", met: password.length >= 6 },
    { id: "letter", label: "Letter", met: /[A-Za-z]/.test(password) },
    { id: "number", label: "Number", met: /\d/.test(password) },
    { id: "special", label: "Symbol", met: /[^A-Za-z0-9]/.test(password) },
  ];
}

function getPasswordStrength(password) {
  if (!password) return { label: "Weak", score: 0 };

  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Za-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score >= 5) return { label: "Strong", score: 4 };
  if (score >= 4) return { label: "Good", score: 3 };
  if (score >= 3) return { label: "Fair", score: 2 };
  return { label: "Weak", score: 1 };
}

function getPasswordSecurityMessage(label) {
  if (label === "Strong") return "Strong resistance";
  if (label === "Good") return "Harder to guess";
  if (label === "Fair") return "Could be stronger";
  return "Easy to guess";
}

function friendlySetupError(error, fallback) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("expired")) return "This setup link has expired. Ask the Super Admin to send a new setup invite.";
  if (message.includes("invalid")) return "This setup link is invalid or already used. Ask the Super Admin to send a new setup invite.";
  if (message.includes("same_password")) return "Choose a password that is different from the current Auth password.";
  if (message.includes("weak")) return "Choose a stronger password before continuing.";
  return fallback;
}

function setupDestination(profile) {
  if (profile?.role === "electoral_board") return "/eb-login";
  if (profile?.role === "super_admin") return "/admin-login";
  return getLoginRouteForRole(profile?.role);
}

function AdminAuthSetup() {
  const navigate = useNavigate();
  const recoveryMode = new URLSearchParams(window.location.search).get("mode") === "recovery";
  const recoveryCallback = new URLSearchParams(window.location.search).has("code") ||
    window.location.hash.includes("type=recovery");
  const isRecoveryFlow = recoveryMode || recoveryCallback;
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedProfile, setCompletedProfile] = useState(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCaptchaToken, setRecoveryCaptchaToken] = useState("");
  const [recoveryCaptchaResetKey, setRecoveryCaptchaResetKey] = useState(0);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryCaptchaConfigured = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const passwordValid = passwordChecks.every((check) => check.met);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = sessionReady && passwordValid && passwordsMatch && !submitting;

  useEffect(() => {
    let active = true;

    async function resolveInviteSession() {
      setCheckingSession(true);
      setErrorMessage("");

      const code = new URLSearchParams(window.location.search).get("code");
      if (recoveryMode && !recoveryCallback) {
        setSessionReady(false);
        setCheckingSession(false);
        return;
      }
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (!active) return;
          setSessionReady(false);
          setErrorMessage(friendlySetupError(exchangeError, "This recovery link is unavailable. Request a new password reset link."));
          setCheckingSession(false);
          return;
        }
      }

      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error || !data?.session?.user) {
        setSessionReady(false);
        setErrorMessage(
          friendlySetupError(
            error,
            "No active admin setup session was found. Open the latest setup invite from your email.",
          ),
        );
        setCheckingSession(false);
        return;
      }

      setSessionReady(true);
      setCheckingSession(false);
    }

    resolveInviteSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (recoveryMode && !recoveryCallback) return;
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        setSessionReady(Boolean(session?.user));
        setErrorMessage("");
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, [recoveryMode, recoveryCallback]);

  async function requestPasswordRecovery(event) {
    event.preventDefault();
    if (recoverySubmitting || (recoveryCaptchaConfigured && !recoveryCaptchaToken)) return;

    setRecoverySubmitting(true);
    setRecoveryError("");
    const redirectTo = new URL("/admin-auth/setup", window.location.origin).toString();
    const options = { redirectTo };
    if (recoveryCaptchaConfigured) options.captchaToken = recoveryCaptchaToken;

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        recoveryEmail.trim().toLowerCase(),
        options,
      );
      if (error) {
        setRecoveryError("We couldn't submit the recovery request. Check the project recovery settings or try again later.");
        return;
      }
      setRecoveryRequested(true);
    } catch {
      setRecoveryError("We couldn't submit the recovery request. Check the project recovery settings or try again later.");
    } finally {
      setRecoverySubmitting(false);
      setRecoveryCaptchaToken("");
      setRecoveryCaptchaResetKey((current) => current + 1);
    }
  }

  function renderRecoveryRequest() {
    return (
      <form onSubmit={requestPasswordRecovery} className="student-setup-flow student-setup-activation">
        <div className="student-setup-intro">
          <div className="student-setup-step-pill">Administrator password recovery</div>
          <h3>Reset your KANDID password</h3>
          <p>Enter the email address already linked to your active administrator account.</p>
        </div>

        {recoveryRequested ? (
          <div className="student-setup-success" role="status" aria-live="polite">
            <CheckCircle2 size={30} aria-hidden="true" />
            <p>If that address is linked to an account, recovery instructions will be sent to it.</p>
          </div>
        ) : (
          <section className="student-setup-password-panel">
            <label className="student-setup-label" htmlFor="admin-recovery-email">
              <span>Administrator email</span>
              <input
                id="admin-recovery-email"
                type="email"
                required
                autoComplete="email"
                value={recoveryEmail}
                onChange={(event) => { setRecoveryEmail(event.target.value); setRecoveryError(""); }}
                placeholder="Enter your registered email"
              />
            </label>

            {recoveryCaptchaConfigured ? (
              <StudentCaptcha
                onToken={setRecoveryCaptchaToken}
                resetKey={recoveryCaptchaResetKey}
              />
            ) : null}

            {recoveryError ? (
              <div className="student-auth-inline-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{recoveryError}</span>
              </div>
            ) : null}

            <button
              disabled={recoverySubmitting || (recoveryCaptchaConfigured && !recoveryCaptchaToken)}
              className="student-auth-submit"
            >
              {recoverySubmitting ? <KandidButtonLoader label="Submitting request..." /> : "Send recovery link"}
            </button>
          </section>
        )}
      </form>
    );
  }

  async function completeSetup(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMessage("");

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setErrorMessage(
        friendlySetupError(passwordError, "We could not set this Auth password. Please try again."),
      );
      setSubmitting(false);
      return;
    }

    await linkCurrentAdminIdentity();
    const { data, error } = await getCurrentAdminProfile({ force: true });

    if (error || !data) {
      setErrorMessage(
        friendlySetupError(
          error,
          "Your password was set, but KANDID could not link this Auth identity to an active admin profile.",
        ),
      );
      setSubmitting(false);
      return;
    }

    if (data.status !== "active") {
      setErrorMessage("This administrator profile is disabled. Contact the Super Admin.");
      setSubmitting(false);
      return;
    }

    setCompletedProfile(data);
    setPassword("");
    setConfirmPassword("");
    await supabase.auth.signOut();
    clearStoredUser();
    setSubmitting(false);
  }

  function renderPasswordForm() {
    return (
      <form onSubmit={completeSetup} className="student-setup-flow student-setup-activation">
        <div className="student-setup-intro">
          <div className="student-setup-step-pill">{isRecoveryFlow ? "Administrator password recovery" : "Admin Auth Setup"}</div>
          <h3>{isRecoveryFlow ? "Choose a new password" : "Secure your KANDID access"}</h3>
          <p>
            This setup is for existing Super Admin and Electoral Board accounts
            that were already approved in KANDID.
          </p>
        </div>

        <section className="student-setup-identity" aria-label="Verified administrator setup">
          <div className="student-setup-section-head">
            <span>Verified setup session</span>
            <p><ShieldCheck size={14} aria-hidden="true" /> Supabase Auth</p>
          </div>
          <div className="student-setup-identity-grid">
            <div className="student-setup-identity-item">
              <span>Account Type</span>
              <strong>
                <LockKeyhole size={15} aria-hidden="true" />
                Administrator
              </strong>
            </div>
            <div className="student-setup-identity-item">
              <span>Access</span>
              <strong>
                <ShieldCheck size={15} aria-hidden="true" />
                Existing KANDID profile
              </strong>
            </div>
          </div>
        </section>

        <section className="student-setup-password-panel">
          <div className="student-setup-section-head">
            <span>{isRecoveryFlow ? "New Auth Password" : "Create Auth Password"}</span>
          </div>

          <label className="student-setup-label">
            <span>Password</span>
            <div className="student-auth-password">
              <input
                id="admin-auth-setup-password"
                required
                data-password-policy="true"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrorMessage("");
                }}
                autoComplete="new-password"
                placeholder="Create a secure password"
              />
              <button
                type="button"
                className="student-auth-eye-btn"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </label>

          <div className="student-password-security" aria-live="polite">
            <div>
              <span>Password security</span>
              <strong>{passwordStrength.label}</strong>
            </div>
            <div className="student-password-strength-bars" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <i key={index} className={index < passwordStrength.score ? "is-active" : ""} />
              ))}
            </div>
            <p>{getPasswordSecurityMessage(passwordStrength.label)}</p>
          </div>

          <div className="student-password-rules">
            <span>Requirements</span>
            {passwordChecks.map((check) => (
              <div key={check.id} className={check.met ? "is-met" : ""}>
                <p>
                  <i aria-hidden="true" />
                  {check.label}
                </p>
                <b aria-hidden="true" />
              </div>
            ))}
          </div>

          <label className="student-setup-label">
            <span>Confirm Password</span>
            <div className="student-auth-password">
              <input
                id="admin-auth-setup-confirm-password"
                required
                data-match-field="#admin-auth-setup-password"
                data-match-message="Confirm password must match your new password."
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setErrorMessage("");
                }}
                autoComplete="new-password"
                placeholder="Retype your password"
              />
              <button
                type="button"
                className="student-auth-eye-btn"
                onClick={() => setShowConfirmPassword((current) => !current)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </label>

          <div className="student-confirm-status" aria-live="polite">
            <p className={confirmPassword && passwordsMatch ? "is-match" : confirmPassword ? "is-mismatch" : ""}>
              {confirmPassword && passwordsMatch ? (
                <CheckCircle2 size={15} aria-hidden="true" />
              ) : confirmPassword ? (
                <XCircle size={15} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" />
              )}
              {confirmPassword
                ? passwordsMatch
                  ? "Password confirmed"
                  : "Passwords do not match yet"
                : "Retype your password"}
            </p>
            <b className={confirmPassword && passwordsMatch ? "is-match" : ""} aria-hidden="true" />
          </div>

          {errorMessage ? (
            <div className="student-auth-inline-error" aria-live="polite">
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <button disabled={!canSubmit} className="student-auth-submit">
            {submitting ? <KandidButtonLoader label={isRecoveryFlow ? "Updating password..." : "Completing setup..."} /> : isRecoveryFlow ? "Update Password" : "Complete Secure Setup"}
          </button>
        </section>
      </form>
    );
  }

  function renderState() {
    if (checkingSession) {
      return (
        <div className="student-setup-success" role="status" aria-live="polite">
          <KandidButtonLoader label="Checking setup link..." />
        </div>
      );
    }

    if (recoveryMode && !sessionReady && !recoveryCallback) {
      return renderRecoveryRequest();
    }

    if (completedProfile) {
      const destination = setupDestination(completedProfile);
      return (
        <div className="student-setup-success" role="status" aria-live="polite">
          <CheckCircle2 size={34} aria-hidden="true" />
          <h3>{isRecoveryFlow ? "Password updated" : "Secure setup complete"}</h3>
          <p>
            {isRecoveryFlow
              ? "Your administrator password was updated. Sign in through the correct portal using your new Supabase Auth password."
              : "Your KANDID administrator access is linked. Sign in through the correct portal using your Supabase Auth password."}
          </p>
          <button
            type="button"
            className="student-auth-submit"
            onClick={() => navigate(destination, { replace: true })}
          >
            Back to Login
          </button>
        </div>
      );
    }

    if (!sessionReady) {
      return (
        <div className="student-setup-success" role="alert" aria-live="polite">
          <AlertCircle size={34} aria-hidden="true" />
          <h3>Setup link unavailable</h3>
          <p>{errorMessage}</p>
          <button
            type="button"
            className="student-auth-submit"
            onClick={() => navigate("/admin-login", { replace: true })}
          >
            Back to Admin Login
          </button>
        </div>
      );
    }

    return renderPasswordForm();
  }

  return (
    <AuthLayout
      roleLabel="Administrator Setup"
      title={completedProfile ? (isRecoveryFlow ? "Password Updated" : "Setup Complete") : isRecoveryFlow ? "Password Recovery" : "Secure Account Setup"}
      copy={isRecoveryFlow ? "Restore access through the administrator email already registered with KANDID." : "Create the Supabase Auth password for an existing KANDID administrator profile."}
      backTo="/admin-login"
      screenClassName="student-setup-auth-screen"
    >
      <div className="student-auth-card student-setup-card kandid-auth-form-card">
        {renderState()}
      </div>
    </AuthLayout>
  );
}

export default AdminAuthSetup;
