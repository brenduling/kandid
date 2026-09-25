import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./StudentSetup.css";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
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
import {
  getPasswordChecks,
  getPasswordStrength,
} from "../../utils/password";
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

function sendOtpErrorMessage(error) {
  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return "Please wait before requesting another verification code.";
  }
  if (error?.code === "email_address_invalid") {
    return "The email address on your student record was rejected. Ask the Electoral Board to check it.";
  }
  if (error?.code === "email_address_not_authorized") {
    return "Verification emails cannot be sent to the address on your student record. Ask the Electoral Board for help.";
  }
  return "We could not send the verification code. Please try again.";
}

function verifyOtpErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.code === "over_request_rate_limit" || message.includes("rate")) {
    return "Please wait before trying to verify your code again.";
  }
  if (error?.code === "otp_expired") {
    return "That verification code has expired. Request a new code.";
  }
  if (/\b(code|otp|token)\b/.test(message)) {
    if (message.includes("expired") && message.includes("invalid")) {
      return "That verification code is invalid or expired. Request a new code.";
    }
    if (message.includes("expired")) return "That verification code has expired. Request a new code.";
    if (message.includes("invalid")) return "That verification code is invalid. Check the code and try again.";
  }
  return "We could not verify that code. Please try again.";
}

function IdentityItem({ label, value, emphasis = false }) {
  return (
    <div className={`student-setup-identity-item${emphasis ? " is-name" : ""}`}>
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

const SETUP_STAGES = [
  { key: "lookup", label: "Find your record", shortLabel: "Find" },
  { key: "password", label: "Secure access", shortLabel: "Secure" },
  { key: "otp", label: "Verify email", shortLabel: "Verify" },
];

const PASSWORD_RULE_LABELS = {
  length: "At least 6 characters",
  letter: "A letter",
  number: "A number",
  special: "A symbol",
};

function SetupProgress({ step }) {
  const activeIndex = SETUP_STAGES.findIndex((stage) => stage.key === step);

  return (
    <nav className="student-setup-progress" aria-label="Account setup progress">
      {SETUP_STAGES.map((stage, index) => (
        <div
          key={stage.key}
          className={`student-setup-progress-step${index === activeIndex ? " is-current" : ""}${index < activeIndex ? " is-complete" : ""}`}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong className="student-setup-progress-label">{stage.label}</strong>
          <strong className="student-setup-progress-short">{stage.shortLabel}</strong>
        </div>
      ))}
    </nav>
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
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const [otpNotice, setOtpNotice] = useState("");
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

    if (error) {
      setSetupError("We couldn't check your student record. Please try again.");
      setLoading(false);
      return;
    }

    if (!data || data.length !== 1) {
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
      setSetupError("This student account is unavailable for setup. Contact the Electoral Board if you think this is a mistake.");
      setLoading(false);
      return;
    }

    setStudent(studentRecord);
    setStep("password");
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setPasteMessage("");
    setOtpNotice("");
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
    setSetupError("");
    if (!student?.email) {
      setSetupError("This student record has no email address. Ask the Electoral Board to add one first.");
      return false;
    }

    setSendingOtp(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: student.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });

    setSendingOtp(false);

    if (error) {
      setSetupError(sendOtpErrorMessage(error));
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
    setOtpNotice("");
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
      setSetupError("We couldn't finish linking your student record. Ask the Electoral Board for help if this continues.");
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
    setOtpNotice("");

    const { error } = await supabase.auth.verifyOtp({
      email: student.email,
      token: otpValue,
      type: "email",
    });

    setVerifyingOtp(false);

    if (error) {
      setSetupError(verifyOtpErrorMessage(error));
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
    setOtpNotice("");
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
    setOtpNotice("");
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

  async function handleResendOtp() {
    setOtpNotice("");
    const sent = await sendOtp();
    if (sent) setOtpNotice("A new code was sent to your registered email.");
  }

  function renderLookupStep() {
    return (
      <form onSubmit={handleCheckStudent} className="student-setup-stage student-setup-lookup">
        <div className="student-setup-stage-intro">
          <h3>Find your student record.</h3>
          <p>Use your Student ID so Kandid can find the record prepared for you.</p>
        </div>

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
            {loading ? <KandidButtonLoader label="Checking record..." /> : <>Find my record <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>

        {loading ? (
          <p className="student-setup-operation" role="status">Checking your student record...</p>
        ) : null}

        {notFound ? (
          <div className="student-setup-feedback is-warning" role="status">
            <strong>We couldn't find your student record.</strong>
            <p>Check your Student ID. If it's correct, ask the Electoral Board about your record.</p>
          </div>
        ) : null}
        {setupError ? (
          <div className={`student-setup-feedback ${setupError.includes("unavailable for setup") ? "is-blocked" : "is-error"}`} role="alert">
            <strong>{setupError.includes("unavailable for setup") ? "Setup unavailable" : "Record check interrupted"}</strong>
            <p>{setupError}</p>
          </div>
        ) : null}

        <div className="student-setup-return">
          <span>Already set up?</span>
          <button type="button" onClick={() => navigate("/student-login")}>
            Return to login <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    );
  }

  function renderIdentityPanel() {
    return (
      <section className="student-setup-identity" aria-label="School-provided student information">
        <div className="student-setup-section-head">
          <span>From your student record</span>
          <p><ShieldCheck size={14} aria-hidden="true" /> Read only</p>
        </div>
        <div className="student-setup-identity-grid">
          <IdentityItem
            label="Name"
            value={`${student.first_name || ""} ${student.last_name || ""}`.trim()}
            emphasis
          />
          <IdentityItem label="Student ID" value={student.student_number} />
          <IdentityItem label="Program" value={student.program} />
          <IdentityItem label="Year Level" value={yearLevelLabel(student.year_level)} />
          <IdentityItem label="Email" value={student.email} />
        </div>
        <p className="student-setup-record-note">These details come from your school record and can’t be edited here.</p>
      </section>
    );
  }

  function renderPasswordStep() {
    return (
      <form onSubmit={handlePasswordContinue} className="student-setup-stage student-setup-flow student-setup-activation">
        <div className="student-setup-stage-intro">
          <h3>Kandid found your record.</h3>
          <p>Check that this is your record, then create your password.</p>
        </div>

        {renderIdentityPanel()}

        <section className="student-setup-password-panel">
          <h4>Create your password</h4>

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

          {password.length >= 6 ? <div className="student-password-security" aria-live="polite">
            <div className="student-password-strength-heading">
              <span>Password strength</span>
              <strong>{passwordStrength.label}</strong>
            </div>
            <div className="student-password-strength-bars" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <i key={index} className={index < passwordStrength.score ? "is-active" : ""} />
              ))}
            </div>
          </div> : null}

          <div className="student-password-rules">
            <span>Requirements</span>
            {passwordChecks.map((check) => (
              <div key={check.id} className={check.met ? "is-met" : ""}>
                <p>
                  <span className="student-password-rule-mark" aria-hidden="true">
                    {check.met ? "✓" : ""}
                  </span>
                  <span className="student-password-rule-voice">
                    {check.met ? "Met: " : "Not met: "}
                  </span>
                  {PASSWORD_RULE_LABELS[check.id] || check.label}
                </p>
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
                onBlur={() => setConfirmTouched(true)}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setConfirmTouched(true);
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

          {confirmTouched || pasteMessage ? <div className="student-confirm-status" aria-live="polite">
            {confirmPassword ? (
              <p className={passwordsMatch ? "is-match" : "is-mismatch"}>
                {passwordsMatch ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <XCircle size={15} aria-hidden="true" />
                )}
                {passwordsMatch ? "Passwords match" : "Passwords do not match yet"}
              </p>
            ) : confirmTouched && !pasteMessage ? (
              <p>Retype your password to confirm it.</p>
            ) : null}
            {pasteMessage ? (
              <p className="is-mismatch">
                <AlertCircle size={15} aria-hidden="true" />
                {pasteMessage}
              </p>
            ) : null}
          </div> : null}

          {setupError ? (
            <div className="student-setup-feedback is-error" role="alert">
              <strong>Verification code not sent</strong>
              <p>{setupError}</p>
            </div>
          ) : null}

          <button disabled={!canContinue} className="student-auth-submit">
            {sendingOtp ? <KandidButtonLoader label="Sending code..." /> : <>Send verification code <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
          {sendingOtp ? (
            <p className="student-setup-operation" role="status">Sending a code to your registered email...</p>
          ) : null}
        </section>
      </form>
    );
  }

  function renderOtpStep() {
    return (
      <form onSubmit={verifyOtp} className="student-setup-stage student-setup-flow student-setup-verify">
        <div className="student-setup-stage-intro">
          <h3>Check your email.</h3>
          <p>Enter the six-digit code sent to <strong>{maskEmail(student.email)}</strong> to confirm this account is yours.</p>
        </div>
        <section className="student-otp-card">
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

          {otpNotice ? (
            <p className="student-setup-operation" role="status">{otpNotice}</p>
          ) : null}
          {setupError ? (
            <div className={`student-setup-feedback ${setupError.includes("account was activated") ? "is-warning" : "is-error"}`} role="alert">
              <strong>{setupError.includes("account was activated") ? "Your account needs a final check" : "Verification interrupted"}</strong>
              <p>{setupError}</p>
            </div>
          ) : null}

          <button disabled={!canVerifyOtp} className="student-auth-submit">
            {verifyingOtp || loading ? <KandidButtonLoader label={loading ? "Finishing setup..." : "Checking code..."} /> : <>Verify and continue <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
          {verifyingOtp || loading || sendingOtp ? (
            <p className="student-setup-operation" role="status">
              {loading ? "Finishing your account setup..." : verifyingOtp ? "Checking your verification code..." : "Sending a new code..."}
            </p>
          ) : null}

          <div className="student-otp-actions">
            <span>Didn't receive the code?</span>
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={sendingOtp || verifyingOtp || loading}
            >
              {sendingOtp ? "Sending..." : "Resend code"}
            </button>
          </div>
        </section>
      </form>
    );
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      title="Complete account setup"
      copy="Find your student record, secure your account, and verify your email."
      backTo="/student-login"
      screenClassName="student-setup-auth-screen"
    >
      <div className="student-auth-card student-setup-card kandid-auth-form-card">
        <SetupProgress step={step} />
        {step === "lookup" ? renderLookupStep() : null}
        {step === "password" && student ? renderPasswordStep() : null}
        {step === "otp" && student ? renderOtpStep() : null}
      </div>
    </AuthLayout>
  );
}

export default StudentSetup;
