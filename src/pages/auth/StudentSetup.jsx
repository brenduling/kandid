import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Home,
  LockKeyhole,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import {
  linkCurrentStudentIdentity,
  requireStudentSession,
  signOutStudentSession,
} from "../../utils/auth";
import { syncStudentOrganizationMemberships } from "../../utils/organizationAccess";

const OTP_LENGTH = 6;

function yearLevelLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "Not provided";
  if (text === "11" || text === "12") return `Grade ${text}`;
  return `Year ${text}`;
}

function maskEmail(email = "") {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return email;
  return `${name[0]}${"*".repeat(Math.max(name.length - 1, 2))}@${domain}`;
}

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
  if (label === "Weak") return "Easy to guess";
  return "Start typing";
}

function friendlyAuthError(error, fallback) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("rate")) return "Please wait before requesting another verification code.";
  if (message.includes("expired")) return "That verification code has expired. Request a new code.";
  if (message.includes("invalid")) return "That verification code is invalid. Check the email and try again.";
  return fallback;
}

function IdentityItem({ label, value }) {
  return (
    <div className="student-setup-identity-item">
      <span>{label}</span>
      <strong>
        <LockKeyhole size={15} aria-hidden="true" />
        {value || "Not provided"}
      </strong>
    </div>
  );
}

function StudentSetup() {
  const location = useLocation();
  const navigate = useNavigate();
  const [studentNumber, setStudentNumber] = useState(location.state?.studentNumber || "");
  const [student, setStudent] = useState(null);
  const [step, setStep] = useState("lookup");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const lookupRequestRef = useRef(0);
  const setupRequestRef = useRef(0);

  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const passwordValid = passwordChecks.every((check) => check.met);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canContinue = passwordValid && passwordsMatch && !sendingOtp && !loading;
  const otpValue = otpDigits.join("");
  const canVerifyOtp = otpValue.length === OTP_LENGTH && !verifyingOtp && !loading;

  const loadStudentRecord = useCallback(async (number, isActive = () => true) => {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    setLoading(true);
    setNotFound(false);
    setSetupError("");

    const { data, error } = await supabase
      .from("students")
      .select("id, student_number, first_name, last_name, email, program, year_level, status")
      .eq("student_number", number)
      .limit(2);

    if (!isActive() || lookupRequestRef.current !== requestId) return;

    if (error || !data || data.length !== 1) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const studentRecord = data[0];

    if (studentRecord.status === "active") {
      navigate("/student-login", { replace: true });
      return;
    }

    if (studentRecord.status === "disabled") {
      setSetupError("This student account is not available for sign-in.");
      setLoading(false);
      return;
    }

    setStudent(studentRecord);
    setStep("password");
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setPasteMessage("");
    setLoading(false);
  }, [navigate]);

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

  useEffect(() => {
    const seededStudentNumber = location.state?.studentNumber;
    if (!seededStudentNumber) return undefined;

    let active = true;

    async function preloadStudent() {
      await loadStudentRecord(seededStudentNumber, () => active);
    }

    preloadStudent();

    return () => {
      active = false;
      lookupRequestRef.current += 1;
    };
  }, [loadStudentRecord, location.state?.studentNumber]);

  async function handleCheckStudent(event) {
    event.preventDefault();
    await loadStudentRecord(studentNumber);
  }

  async function sendOtp() {
    if (!student?.email) {
      setSetupError("This student record has no email address. Ask the Electoral Board to add one first.");
      return false;
    }

    setSendingOtp(true);
    setSetupError("");

    const { error } = await supabase.auth.signInWithOtp({
      email: student.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });

    setSendingOtp(false);

    if (error) {
      setSetupError(friendlyAuthError(error, "We could not send the verification code. Please try again."));
      return false;
    }

    return true;
  }

  async function handlePasswordContinue(event) {
    event.preventDefault();
    setSetupError("");
    setPasteMessage("");

    if (!passwordValid || !passwordsMatch) return;

    const sent = await sendOtp();
    if (!sent) return;

    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setStep("otp");
    window.setTimeout(() => {
      document.querySelector("[data-student-otp-index='0']")?.focus();
    }, 80);
  }

  async function completeSetup() {
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    setLoading(true);
    setSetupError("");

    const { error: passwordError } = await supabase.auth.updateUser({ password });

    if (setupRequestRef.current !== requestId) return false;

    if (passwordError) {
      setSetupError("We could not complete your account setup. Please try again.");
      setLoading(false);
      return false;
    }

    const { data: linkedStudent, error: linkError } = await linkCurrentStudentIdentity({
      studentNumber: student.student_number,
      setupMode: true,
    });

    if (setupRequestRef.current !== requestId) return false;

    if (linkError || !linkedStudent) {
      await signOutStudentSession();
      setSetupError("We couldn't verify your student account. Check your details and try again.");
      setLoading(false);
      return false;
    }

    const { error: membershipError } = await syncStudentOrganizationMemberships({
      studentId: student.id,
      program: student.program,
    });

    if (setupRequestRef.current !== requestId) return false;

    if (membershipError) {
      console.error("Failed to link student to organizations:", membershipError);
      setSetupError("Your account was activated, but organization syncing needs to be retried by the Electoral Board.");
      setLoading(false);
      return false;
    }

    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setPasteMessage("");
    setLoading(false);
    navigate("/student/dashboard", { replace: true });
    return true;
  }

  async function verifyOtp(event) {
    event.preventDefault();
    if (!canVerifyOtp) return;

    setVerifyingOtp(true);
    setSetupError("");

    const { error } = await supabase.auth.verifyOtp({
      email: student.email,
      token: otpValue,
      type: "email",
    });

    setVerifyingOtp(false);

    if (error) {
      setSetupError(friendlyAuthError(error, "We could not verify that code. Please try again."));
      document.querySelector("[data-student-otp-index='0']")?.focus();
      return;
    }

    await completeSetup();
  }

  function handleStudentNumberChange(event) {
    lookupRequestRef.current += 1;
    setStudentNumber(event.target.value);
    setLoading(false);
    setNotFound(false);
    setSetupError("");
  }

  function handleConfirmPaste(event) {
    event.preventDefault();
    setPasteMessage("Please retype your password to confirm it.");
  }

  function handleOtpChange(index, event) {
    const digit = event.target.value.replace(/\D/g, "").slice(-1);
    setSetupError("");
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
    setSetupError("");
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

  function renderLookupStep() {
    return (
      <form onSubmit={handleCheckStudent}>
        <div className="student-auth-fields">
          <label>
            <span>Student ID Number</span>
            <input
              required
              value={studentNumber}
              onChange={handleStudentNumberChange}
              inputMode="numeric"
              autoComplete="username"
              placeholder="e.g. 12345"
            />
          </label>

          <button disabled={loading} className="student-auth-submit">
            {loading ? <KandidButtonLoader label="Verifying..." /> : "Verify Student ID"}
          </button>
        </div>

        <div className="student-auth-divider">
          <span />
          <p>NEW USER</p>
          <span />
        </div>

        <button
          type="button"
          onClick={() => navigate("/student-login")}
          className="student-auth-setup-link"
        >
          <span className="student-auth-setup-icon">
            <Home size={16} />
          </span>
          Already set up? <strong>Return to login</strong>
        </button>

        {notFound ? (
          <p className="mt-5 text-center text-sm font-bold text-[#d34222]">
            We couldn't verify your student account. Check your details and try again.
          </p>
        ) : null}
        {setupError ? (
          <div className="student-auth-inline-error mt-5" aria-live="polite">
            <AlertCircle size={18} />
            <span>{setupError}</span>
          </div>
        ) : null}
      </form>
    );
  }

  function renderIdentityPanel() {
    return (
      <section className="student-setup-identity" aria-label="Administrator-provided student information">
        <div className="student-setup-section-head">
          <span>Your Information</span>
          <p><ShieldCheck size={14} aria-hidden="true" /> Verified information</p>
        </div>
        <div className="student-setup-identity-grid">
          <IdentityItem label="Student ID" value={student.student_number} />
          <IdentityItem
            label="Name"
            value={`${student.first_name || ""} ${student.last_name || ""}`.trim()}
          />
          <IdentityItem label="Email" value={student.email} />
          <IdentityItem label="Program" value={student.program} />
          <IdentityItem label="Year Level" value={yearLevelLabel(student.year_level)} />
        </div>
      </section>
    );
  }

  function renderPasswordStep() {
    return (
      <form onSubmit={handlePasswordContinue} className="student-setup-flow student-setup-activation">
        <div className="student-setup-intro">
          <div className="student-setup-step-pill">Account Setup - Step 1 of 2</div>
          <h3>Create your KANDID account</h3>
          <p>
            Your identity has already been prepared by your administrator.
            Secure your account to finish activation.
          </p>
        </div>

        <div className="student-activation-rail" aria-label="Account activation progress">
          <span>Identity confirmed</span>
          <i />
          <span>Secure your account</span>
        </div>

        {renderIdentityPanel()}

        <section className="student-setup-password-panel">
          <div className="student-setup-section-head">
            <span>Secure Your Account</span>
          </div>

          <label className="student-setup-label">
            <span>Password</span>
            <div className="student-auth-password">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setSetupError("");
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
                required
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onPaste={handleConfirmPaste}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setPasteMessage("");
                  setSetupError("");
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
            {pasteMessage ? (
              <p className="is-mismatch">
                <AlertCircle size={15} aria-hidden="true" />
                {pasteMessage}
              </p>
            ) : null}
          </div>

          {setupError ? (
            <div className="student-auth-inline-error" aria-live="polite">
              <AlertCircle size={18} />
              <span>{setupError}</span>
            </div>
          ) : null}

          <button disabled={!canContinue} className="student-auth-submit">
            {sendingOtp ? <KandidButtonLoader label="Sending code..." /> : "Continue"}
          </button>
        </section>
      </form>
    );
  }

  function renderOtpStep() {
    return (
      <form onSubmit={verifyOtp} className="student-setup-flow">
        <div className="student-setup-step-pill">Verify Account - Step 2 of 2</div>
        <section className="student-otp-card">
          <div className="student-otp-brand">KANDID</div>
          <h3>Verify your account</h3>
          <p>
            We sent a 6-digit verification code to{" "}
            <strong>{maskEmail(student.email)}</strong>.
          </p>

          <div className="student-otp-boxes" onPaste={handleOtpPaste}>
            {otpDigits.map((digit, index) => (
              <input
                key={index}
                data-student-otp-index={index}
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

          {setupError ? (
            <div className="student-auth-inline-error" aria-live="polite">
              <AlertCircle size={18} />
              <span>{setupError}</span>
            </div>
          ) : null}

          <button disabled={!canVerifyOtp} className="student-auth-submit">
            {verifyingOtp || loading ? <KandidButtonLoader label="Verifying..." /> : "Verify"}
          </button>

          <div className="student-otp-actions">
            <span>Didn't receive the code?</span>
            <button
              type="button"
              onClick={sendOtp}
              disabled={sendingOtp || verifyingOtp || loading}
            >
              {sendingOtp ? "Sending..." : "Resend code"}
            </button>
          </div>
        </section>
      </form>
    );
  }

  function renderSuccessStep() {
    return (
      <div className="student-setup-success" role="status" aria-live="polite">
        <CheckCircle2 size={34} aria-hidden="true" />
        <h3>Account setup complete</h3>
        <p>
          Your account has been verified successfully. Continue to your Student Portal.
        </p>
        <button
          type="button"
          className="student-auth-submit"
          onClick={() => navigate("/student/dashboard", { replace: true })}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      title={step === "lookup" ? "Student Setup" : step === "otp" ? "Verify Account" : "Complete Account Setup"}
      copy="Verify your student record and create your portal access."
      backTo="/student-login"
      screenClassName="student-setup-auth-screen"
    >
      <div className="student-auth-card student-setup-card kandid-auth-form-card">
        {step === "lookup" ? renderLookupStep() : null}
        {step === "password" && student ? renderPasswordStep() : null}
        {step === "otp" && student ? renderOtpStep() : null}
        {step === "success" ? renderSuccessStep() : null}
      </div>
    </AuthLayout>
  );
}

export default StudentSetup;
