import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import {
  linkCurrentStudentIdentity,
  requireStudentSession,
  resolveStudentLogin,
  signOutStudentSession,
} from "../../utils/auth";

const OTP_LENGTH = 6;

function friendlyAuthError(error, fallback) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("rate")) return "Please wait before requesting another verification code.";
  if (message.includes("expired")) return "That verification code has expired. Request a new code.";
  if (message.includes("invalid")) return "That verification code is invalid. Check the email and try again.";
  return fallback;
}

function maskEmail(email = "") {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return email;
  return `${name[0]}${"*".repeat(Math.max(name.length - 1, 2))}@${domain}`;
}

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [step, setStep] = useState("credentials");
  const [pendingStudent, setPendingStudent] = useState(null);
  const [recoveryCandidate, setRecoveryCandidate] = useState(null);
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const loginRequestRef = useRef(0);
  const navigate = useNavigate();
  const otpValue = otpDigits.join("");
  const canVerifyOtp = otpValue.length === OTP_LENGTH && !verifyingOtp && !loading;

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data } = await requireStudentSession();
      if (active && data?.role === "student") {
        navigate("/student/dashboard", { replace: true });
      }
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, [navigate]);

  async function sendLoginOtp(student) {
    if (!student?.email) {
      setAuthError("If this account is eligible, recovery instructions will be sent to the registered email.");
      return false;
    }

    setSendingOtp(true);
    setAuthError("");

    const { error } = await supabase.auth.signInWithOtp({
      email: student.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });

    setSendingOtp(false);

    if (error) {
      setAuthError(friendlyAuthError(error, "We could not send the verification code. Please try again."));
      return false;
    }

    return true;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const requestId = loginRequestRef.current + 1;
    loginRequestRef.current = requestId;
    setLoading(true);
    setNotFound(false);
    setAuthError("");
    setRecoveryCandidate(null);

    const { data, error } = await resolveStudentLogin(studentNumber);

    if (loginRequestRef.current !== requestId) return;

    if (error || !data?.login_email) {
      setAuthError("We couldn't sign you in. Check your Student ID and password.");
      setLoading(false);
      return;
    }

    if (data.setup_required) {
      navigate("/student-setup", { replace: true, state: { studentNumber } });
      setLoading(false);
      return;
    }

    if (!data.login_available) {
      setAuthError("We couldn't sign you in. Check your Student ID and password.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: data.login_email,
      password,
    });

    if (loginRequestRef.current !== requestId) return;

    if (signInError) {
      await signOutStudentSession();
      setRecoveryCandidate({
        student_number: studentNumber,
        email: data.login_email,
      });
      setAuthError("We couldn't sign you in. Check your Student ID and password.");
      setLoading(false);
      return;
    }

    const { data: studentProfile } = await requireStudentSession({ force: true });
    if (
      !studentProfile ||
      String(studentProfile.student_number) !== String(studentNumber).trim()
    ) {
      await signOutStudentSession();
      setAuthError("We couldn't sign you in. Check your Student ID and password.");
      setLoading(false);
      return;
    }

    setPassword("");
    setLoading(false);
    navigate("/student/dashboard", { replace: true });
  }

  async function startPasswordSetup() {
    if (!recoveryCandidate) return;

    const sent = await sendLoginOtp(recoveryCandidate);
    if (!sent) return;

    setPendingStudent(recoveryCandidate);
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setStep("otp");
    setAuthError("We sent a verification code to your registered email.");
    window.setTimeout(() => {
      document.querySelector("[data-student-login-otp-index='0']")?.focus();
    }, 80);
  }

  function handleStudentNumberChange(event) {
    loginRequestRef.current += 1;
    setStudentNumber(event.target.value);
    setLoading(false);
    setNotFound(false);
    setAuthError("");
    setStep("credentials");
    setPendingStudent(null);
    setRecoveryCandidate(null);
    setOtpDigits(Array(OTP_LENGTH).fill(""));
  }

  function handlePasswordChange(event) {
    loginRequestRef.current += 1;
    setPassword(event.target.value);
    setLoading(false);
    setAuthError("");
    setRecoveryCandidate(null);
  }

  async function verifyOtp(event) {
    event.preventDefault();
    if (!canVerifyOtp || !pendingStudent) return;

    setVerifyingOtp(true);
    setAuthError("");

    const { error } = await supabase.auth.verifyOtp({
      email: pendingStudent.email,
      token: otpValue,
      type: "email",
    });

    if (error) {
      setVerifyingOtp(false);
      setAuthError(friendlyAuthError(error, "We could not verify that code. Please try again."));
      document.querySelector("[data-student-login-otp-index='0']")?.focus();
      return;
    }

    const { data: existingStudent } = await requireStudentSession({ force: true });
    if (existingStudent?.role === "student") {
      if (String(existingStudent.student_number) !== String(pendingStudent.student_number)) {
        await signOutStudentSession();
        setVerifyingOtp(false);
        setAuthError("We couldn't verify your student account. Check your details and try again.");
        setStep("credentials");
        setPendingStudent(null);
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        return;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) {
        await signOutStudentSession();
        setVerifyingOtp(false);
        setAuthError("We couldn't set up password sign-in. Please try again.");
        setStep("credentials");
        setPendingStudent(null);
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        return;
      }

      setVerifyingOtp(false);
      setPassword("");
      setPendingStudent(null);
      setRecoveryCandidate(null);
      navigate("/student/dashboard", { replace: true });
      return;
    }

    const { data, error: linkError } = await linkCurrentStudentIdentity({
      studentNumber,
      legacyPassword: password,
    });

    setVerifyingOtp(false);

    if (linkError || !data) {
      await signOutStudentSession();
      setAuthError("We couldn't verify your student account. Check your details and try again.");
      setStep("credentials");
      setPendingStudent(null);
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      await signOutStudentSession();
      setAuthError("We couldn't set up password sign-in. Please try again.");
      setStep("credentials");
      setPendingStudent(null);
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      return;
    }

    setPassword("");
    setPendingStudent(null);
    setRecoveryCandidate(null);
    navigate("/student/dashboard", { replace: true });
  }

  function handleOtpChange(index, event) {
    const digit = event.target.value.replace(/\D/g, "").slice(-1);
    setAuthError("");
    setOtpDigits((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) {
      event.target.nextElementSibling?.focus();
    }
  }

  function handleOtpPaste(event) {
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH)
      .split("");

    if (digits.length === 0) return;

    event.preventDefault();
    setAuthError("");
    setOtpDigits(Array.from({ length: OTP_LENGTH }, (_, index) => digits[index] || ""));
    const boxes = event.currentTarget.querySelectorAll("input");
    boxes[Math.min(digits.length, OTP_LENGTH) - 1]?.focus();
  }

  function handleOtpKeyDown(index, event) {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      event.currentTarget.previousElementSibling?.focus();
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      event.currentTarget.previousElementSibling?.focus();
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      event.currentTarget.nextElementSibling?.focus();
    }
  }

  function renderCredentialsForm() {
    return (
      <form onSubmit={handleLogin} className={notFound ? "student-auth-blur" : ""}>
        <h3 className="student-login-form-heading">Sign in</h3>
        <div className="student-auth-fields">
          <label>
            <span>Student ID Number</span>
            <input
              required
              autoComplete="username"
              inputMode="numeric"
              value={studentNumber}
              onChange={handleStudentNumberChange}
              placeholder="e.g. 12345"
            />
          </label>

          <label>
            <span>Password</span>
            <div className="student-auth-password">
              <input
                required
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter your secure access code"
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

          {authError ? (
            <div className="student-auth-inline-error">
              <AlertCircle size={18} />
              <span>{authError}</span>
            </div>
          ) : null}

          {recoveryCandidate ? (
            <button
              type="button"
              onClick={startPasswordSetup}
              disabled={sendingOtp || loading}
              className="student-auth-submit"
            >
              {sendingOtp ? <KandidButtonLoader label="Sending code..." /> : "Set up or reset password"}
            </button>
          ) : null}

          <button type="submit" disabled={loading || sendingOtp} className="student-auth-submit">
            {loading ? <KandidButtonLoader label="Signing in..." /> : <>Sign In <ArrowRight size={19} aria-hidden="true" /></>}
          </button>
        </div>

        <div className="student-login-new-account">
          <span>First time here?</span>
          <button
            type="button"
            onClick={() => navigate("/student-setup")}
            className="student-auth-setup-link"
          >
            Complete account setup <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    );
  }

  function renderOtpForm() {
    return (
      <form onSubmit={verifyOtp}>
        <div className="student-auth-fields">
          <div className="student-setup-step-pill">Verify Account</div>
          <div className="student-otp-card">
            <div className="student-otp-brand">KANDID</div>
            <h3>Check your registered email</h3>
            <p>
              We sent a verification code to{" "}
              <strong>{maskEmail(pendingStudent?.email)}</strong>.
            </p>

            <div className="student-otp-boxes" onPaste={handleOtpPaste}>
              {otpDigits.map((digit, index) => (
                <input
                  key={index}
                  data-student-login-otp-index={index}
                  aria-label={`Verification code digit ${index + 1}`}
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={digit}
                  onChange={(event) => handleOtpChange(index, event)}
                  onKeyDown={(event) => handleOtpKeyDown(index, event)}
                />
              ))}
            </div>

            {authError ? (
              <div className="student-auth-inline-error" aria-live="polite">
                <AlertCircle size={18} />
                <span>{authError}</span>
              </div>
            ) : null}

            <button type="submit" disabled={!canVerifyOtp} className="student-auth-submit">
              {verifyingOtp || loading ? <KandidButtonLoader label="Verifying..." /> : "Verify and Set Password"}
            </button>

            <div className="student-otp-actions">
              <span>Didn't receive the code?</span>
              <button
                type="button"
                onClick={() => sendLoginOtp(pendingStudent)}
                disabled={sendingOtp || verifyingOtp || loading}
              >
                {sendingOtp ? "Sending..." : "Resend code"}
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      title="Let's get you in."
      copy="Sign in to view your organizations, elections, receipts, and results."
      backTo="/"
      screenClassName="kandid-auth-screen--student"
    >
      <div className="student-auth-card kandid-auth-form-card">
        {step === "otp" ? renderOtpForm() : renderCredentialsForm()}

        {notFound ? (
          <div className="student-auth-error">
            <div className="student-auth-error-icon">
              <AlertCircle size={20} />
            </div>
            <h3>We couldn't verify your student account.</h3>
            <p>Check your details and try again.</p>
            <button type="button" onClick={() => setNotFound(false)}>
              Back to Search
            </button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}

export default StudentLogin;
