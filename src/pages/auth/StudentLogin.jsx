import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import {
  authenticateStudentByNumber,
  requireStudentSession,
  signOutStudentSession,
} from "../../utils/auth";
import { getStudentLoginValidationErrors, getStudentLoginFailureMessage } from "../../utils/studentLoginValidation";

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const loginRequestRef = useRef(0);
  const loginInFlightRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data } = await requireStudentSession().catch(() => ({ data: null }));
      if (active && !loginInFlightRef.current && data?.role === "student") {
        navigate("/student/dashboard", { replace: true });
      }
    }

    restoreSession();

    return () => {
      active = false;
      loginRequestRef.current += 1;
    };
  }, [navigate]);

  async function handleLogin(event) {
    event.preventDefault();
    if (loginInFlightRef.current) return;
    const validationErrors = getStudentLoginValidationErrors(studentNumber, password);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const requestId = loginRequestRef.current + 1;
    loginRequestRef.current = requestId;
    loginInFlightRef.current = true;
    setLoading(true);
    setAuthError("");
    try {
      const { error } = await authenticateStudentByNumber({ studentNumber, password });
      if (loginRequestRef.current !== requestId) return;
      if (error) {
        setAuthError(getStudentLoginFailureMessage(error));
        return;
      }

      const { data: studentProfile, error: profileError } = await requireStudentSession({ force: true });
      if (loginRequestRef.current !== requestId) return;
      if (profileError || !studentProfile) {
        setAuthError("Your sign-in succeeded, but we couldn't verify your Student profile. Try again or contact the Electoral Board.");
        return;
      }
      if (String(studentProfile.student_number) !== String(studentNumber).trim()) {
        await signOutStudentSession();
        if (loginRequestRef.current !== requestId) return;
        setAuthError("This session does not match the Student ID entered. Sign in with the correct account.");
        return;
      }

      setPassword("");
      navigate("/student/dashboard", { replace: true });
    } catch {
      if (loginRequestRef.current === requestId) setAuthError("We couldn't complete sign-in. Check your connection and try again.");
    } finally {
      loginInFlightRef.current = false;
      if (loginRequestRef.current === requestId) setLoading(false);
    }
  }

  function handleStudentNumberChange(event) {
    loginRequestRef.current += 1;
    setStudentNumber(event.target.value);
    setFieldErrors((current) => ({ ...current, studentNumber: "" }));
    setLoading(false);
    setAuthError("");
  }

  function handlePasswordChange(event) {
    loginRequestRef.current += 1;
    setPassword(event.target.value);
    setFieldErrors((current) => ({ ...current, password: "" }));
    setLoading(false);
    setAuthError("");
  }

  function renderCredentialsForm() {
    return (
      <form onSubmit={handleLogin} noValidate>
        <h3 className="student-login-form-heading">Sign in</h3>
        <div className="student-auth-fields">
          <label htmlFor="student-login-number">
            <span>Student ID Number</span>
            <input
              id="student-login-number"
              disabled={loading}
              data-validation-ignore="true"
              autoComplete="username"
              inputMode="numeric"
              value={studentNumber}
              onChange={handleStudentNumberChange}
              placeholder="e.g. 12345"
              aria-invalid={fieldErrors.studentNumber ? "true" : undefined}
              aria-describedby={fieldErrors.studentNumber ? "student-login-number-error" : undefined}
            />
            {fieldErrors.studentNumber ? (
              <small id="student-login-number-error" role="alert">{fieldErrors.studentNumber}</small>
            ) : null}
          </label>

          <label htmlFor="student-login-password">
            <span>Password</span>
            <div className="student-auth-password">
              <input
                id="student-login-password"
                disabled={loading}
                data-validation-ignore="true"
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter your secure access code"
                aria-invalid={fieldErrors.password ? "true" : undefined}
                aria-describedby={fieldErrors.password ? "student-login-password-error" : undefined}
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
            {fieldErrors.password ? (
              <small id="student-login-password-error" role="alert">{fieldErrors.password}</small>
            ) : null}
          </label>

          {authError ? (
            <div className="student-auth-inline-error">
              <AlertCircle size={18} />
              <span>{authError}</span>
            </div>
          ) : null}

          <button type="submit" disabled={loading} className="student-auth-submit">
            {loading ? <KandidButtonLoader label="Signing in..." /> : <>Sign In <ArrowRight size={19} aria-hidden="true" /></>}
          </button>
        </div>

        <div className="student-login-new-account">
          <span>First time here?</span>
          <button
            type="button"
            onClick={() => navigate("/student-setup", { state: { studentNumber } })}
            className="student-auth-setup-link"
          >
            Complete account setup <ArrowRight size={16} aria-hidden="true" />
          </button>
          <small>Account setup and password recovery use your registered email.</small>
        </div>
      </form>
    );
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      identityTitle="Let's get you in."
      title="Let's get you in."
      copy="Sign in to view your organizations, elections, receipts, and results."
      backTo="/"
      screenClassName="kandid-auth-screen--student"
    >
      <div className="student-auth-card kandid-auth-form-card">
        {renderCredentialsForm()}

      </div>
    </AuthLayout>
  );
}

export default StudentLogin;
