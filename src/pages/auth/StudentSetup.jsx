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
import {
  beginStudentAccessVerification,
  inspectStudentSetup,
  linkCurrentStudentIdentity,
  requireStudentSession,
  signOutStudentSetupSession,
  verifyStudentAccessCode,
} from "../../utils/auth";
import {
  getPasswordChecks,
  getPasswordStrength,
} from "../../utils/password";
import {
  getStudentOtpVerificationError,
  getStudentOtpFailureMessage,
  getStudentOtpRetrySeconds,
  STUDENT_OTP_REQUEST_NOTICE,
  getStudentSetupRequestError,
} from "../../utils/studentSetupValidation";
import { isStudentAccountSetupEnabled } from "../../utils/studentAccountSetupFeatureGate";

const OTP_LENGTH = 6;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

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
  const activeIndex = step === "success" ? SETUP_STAGES.length : step === "existing" ? 2 : SETUP_STAGES.findIndex((stage) => stage.key === step);

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
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const lookupRequestRef = useRef(0);
  const setupRequestRef = useRef(0);
  const verificationInFlightRef = useRef(false);
  const dispatchInFlightRef = useRef(false);

  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const passwordValid = passwordChecks.every((check) => check.met);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const otpValue = otpDigits.join("");

  const loadStudentRecord = useCallback(async (number, isActive = () => true) => {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    setNotFound(false);
    setSetupError("");
    const normalized = typeof number === "string" ? number.trim() : "";
    if (!/^[0-9]{1,20}$/.test(normalized)) {
      setNotFound(true);
      return;
    }
    setLoading(true);
    let result;
    try {
      result = await inspectStudentSetup({ studentNumber: normalized });
    } catch {
      result = { error: true };
    }
    if (!isActive() || lookupRequestRef.current !== requestId) return;
    setLoading(false);
    if (result.error || !result.data) {
      setSetupError("We couldn't check your Student ID securely. Try again or contact the Electoral Board.");
      return;
    }
    setStudent(result.data);
    setStep("password");
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setPasteMessage("");
    setOtpNotice("");
    setResendCooldown(0);
  }, []);

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
    if (resendCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => () => { lookupRequestRef.current += 1; }, []);

  async function handleCheckStudent(event) {
    event.preventDefault();
    await loadStudentRecord(studentNumber);
  }

  async function sendOtp() {
    if (dispatchInFlightRef.current || resendCooldown > 0 || loading || verifyingOtp) return false;
    setSetupError("");
    if (!student?.student_number) {
      setSetupError("Find your Student ID record before requesting email verification.");
      return false;
    }
    if (!isStudentAccountSetupEnabled() && import.meta.env.VITE_ENABLE_ISOLATED_STUDENT_SETUP_TESTS !== "true") {
      setSetupError("Student account setup is not enabled in this development build yet.");
      return false;
    }
    dispatchInFlightRef.current = true;
    setSendingOtp(true);
    let requestResult;
    try {
      const result = await beginStudentAccessVerification({
        studentNumber: student.student_number,
      });
      requestResult = result;
    } catch {
      requestResult = { error: true };
    } finally {
      setSendingOtp(false);
      dispatchInFlightRef.current = false;
    }

    if (requestResult?.error) {
      setResendCooldown(getStudentOtpRetrySeconds(requestResult.error));
      setSetupError(Number(requestResult.error?.context?.status || requestResult.error?.status) === 429
        ? "Too many code requests. Wait for the cooldown before requesting another code."
        : "We couldn't confirm your code request. Check your connection and wait before trying again.");
      return false;
    }
    setSetupError("");
    setResendCooldown(Math.min(3600, Math.max(OTP_RESEND_COOLDOWN_SECONDS, Number(requestResult?.data?.retry_after_seconds) || 0)));
    setOtpNotice(STUDENT_OTP_REQUEST_NOTICE);
    return true;
  }

  async function handlePasswordContinue(event) {
    event.preventDefault();
    setPasteMessage("");
    const validationError = getStudentSetupRequestError({
      studentNumber: student?.student_number,
      passwordValid,
      passwordsMatch,
    });
    if (validationError) {
      setSetupError(validationError);
      return;
    }
    const sent = await sendOtp();
    if (!sent) return;
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpNotice(STUDENT_OTP_REQUEST_NOTICE);
    setStep("otp");
  }

  async function completeSetup() {
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    setLoading(true);
    setSetupError("");

    try {
      const linkResult = await linkCurrentStudentIdentity({
        studentNumber: student.student_number,
        setupMode: true,
        password,
      });
      if (setupRequestRef.current !== requestId) return false;
      if (linkResult.error || linkResult.data?.status !== "active" || linkResult.data?.student_number !== student.student_number) {
        setSetupError("We couldn't finish verifying this account. Check your account details and try again, or contact the Electoral Board.");
        return false;
      }

      setPassword("");
      setConfirmPassword("");
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setPasteMessage("");
      setStep("success");
      return true;
    } catch {
      setSetupError("We couldn't complete account setup because the request failed. Check your connection and try again.");
      return false;
    } finally {
      if (setupRequestRef.current === requestId) setLoading(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    if (verificationInFlightRef.current || loading || sendingOtp) return;
    const validationError = getStudentOtpVerificationError({
      code: otpValue,
    });
    if (validationError) {
      setSetupError(validationError);
      return;
    }

    verificationInFlightRef.current = true;
    setVerifyingOtp(true);
    setSetupError("");
    setOtpNotice("");

    try {
      const verificationResult = await verifyStudentAccessCode({
        studentNumber: student.student_number,
        code: otpValue,
      });
      if (verificationResult?.error || !verificationResult?.data?.session) {
        if (Number(verificationResult?.error?.context?.status || verificationResult?.error?.status) === 429) {
          setResendCooldown(getStudentOtpRetrySeconds(verificationResult.error));
        }
        setSetupError(getStudentOtpFailureMessage(verificationResult?.error));
        document.querySelector("[data-student-otp-index='0']")?.focus();
        return;
      }
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setSetupError("");
      const verifiedDetails = verificationResult.data.student_details;
      if (verifiedDetails?.details_verified && verifiedDetails.student_number === student.student_number) {
        setStudent(verifiedDetails);
        if (verifiedDetails.account_state === "active") {
          setStep("existing");
          return;
        }
      }
      await completeSetup();
    } catch {
      setSetupError(getStudentOtpFailureMessage());
    } finally {
      setVerifyingOtp(false);
      verificationInFlightRef.current = false;
    }
  }

  function handleStudentNumberChange(event) {
    lookupRequestRef.current += 1;
    setStudentNumber(event.target.value);
    setLoading(false);
    setNotFound(false);
    setSetupError("");
    setStudent(null);
    setResendCooldown(0);
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
    if (resendCooldown > 0 || sendingOtp || verifyingOtp || loading) return;
    setOtpNotice("");
    const sent = await sendOtp();
    if (sent) setOtpNotice(STUDENT_OTP_REQUEST_NOTICE);
  }

  function renderLookupStep() {
    return (
      <form noValidate onSubmit={handleCheckStudent} className="student-setup-stage student-setup-lookup">
        <div className="student-setup-stage-intro">
          <h3>Find your student record.</h3>
          <p>Enter the Student ID given to you by your Electoral Board.</p>
        </div>

        <div className="student-auth-fields">
          <label>
            <span>Student ID Number</span>
            <input
              value={studentNumber}
              onChange={handleStudentNumberChange}
              inputMode="numeric"
              autoComplete="username"
              placeholder="e.g. 12345"
            />
          </label>

          <button disabled={loading} className="student-auth-submit">
            {loading ? <KandidButtonLoader label="Checking record..." /> : <>Verify Student ID <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>

        {loading ? (
          <p className="student-setup-operation" role="status">Checking your student record...</p>
        ) : null}

        {notFound ? (
          <div className="student-setup-feedback is-warning" role="status">
            <strong>Check your Student ID format.</strong>
            <p>{studentNumber.trim() ? "Use digits only. If you need help, contact the Electoral Board." : "Enter your Student ID using digits only. If you need help, contact the Electoral Board."}</p>
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
      <section className="student-setup-identity" aria-label="Account verification information">
        <div className="student-setup-section-head">
          <span>Verify your account</span>
          <p><ShieldCheck size={14} aria-hidden="true" /> Read only</p>
        </div>
        <div className="student-setup-identity-grid" aria-label="Read-only student details">
          {[
            ["Student ID", student?.student_number],
            ["Student name", student?.details_verified ? [student.first_name, student.last_name].filter(Boolean).join(" ") || "Not recorded" : "Protected until email verification"],
            ["Registered email", student?.details_verified ? student.email : "Protected until email verification"],
            ["Program", student?.details_verified ? student.program || "Not recorded" : "Protected until email verification"],
            ["Year level", student?.details_verified ? student.year_level || "Not recorded" : "Protected until email verification"],
            ["Enrollment", student?.details_verified ? student.enrollments?.map((term) => `Term ${term.academic_term_id}: ${term.program} / Year ${term.year_level} / ${term.enrollment_status}`).join("; ") || "No enrollment details available" : "Protected until email verification"],
          ].map(([label, value]) => <div className="student-setup-identity-item" key={label}>
            <span>{label}</span><strong>{value}</strong>
          </div>)}
        </div>
        <p className="student-setup-record-note">
          {student?.details_verified ? "These details were confirmed after email verification and cannot be edited here." : "A code is sent only to the email already recorded for an eligible Student account. Personal details stay protected until email verification. This check does not disclose whether a Student ID is on file."}
        </p>
      </section>
    );
  }

  function renderPasswordStep() {
    return (
      <form noValidate onSubmit={handlePasswordContinue} className="student-setup-stage student-setup-flow student-setup-activation">
        <div className="student-setup-stage-intro">
          <h3>Secure your Student account.</h3>
          <p>Choose a password that meets the requirements, then verify the email already recorded for your Student account.</p>
        </div>

        {renderIdentityPanel()}

        <section className="student-setup-password-panel">
          <h4>Create or reset your password</h4>

          <label className="student-setup-label">
            <span>Password</span>
            <div className="student-auth-password">
              <input
                id="student-setup-new-password"
                required
                data-password-policy="true"
                data-validation-label="Password"
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
                id="student-setup-confirm-password"
                required
                data-match-field="#student-setup-new-password"
                data-validation-label="Confirm Password"
                data-match-message="Confirm password must match your new password."
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
              <strong>Check your setup requirements</strong>
              <p>{setupError}</p>
            </div>
          ) : null}

          <button disabled={sendingOtp || loading || resendCooldown > 0} className="student-auth-submit">
            {sendingOtp ? <KandidButtonLoader label="Sending code..." /> : <>Send Verification Code <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
          {sendingOtp ? (
            <p className="student-setup-operation" role="status">Checking your request. If eligible, a code will be sent to the email on file.</p>
          ) : null}
          {!sendingOtp && resendCooldown > 0 ? <p className="student-setup-operation" role="status">Wait {resendCooldown}s before requesting another code.</p> : null}
        </section>
      </form>
    );
  }

  function renderOtpStep() {
    return (
      <form noValidate onSubmit={verifyOtp} className="student-setup-stage student-setup-flow student-setup-verify">
        <div className="student-setup-stage-intro">
          <h3>Check your registered email.</h3>
          <p>A code can be sent only to the email already recorded for an eligible Student account.</p>
        </div>
        <section className="student-otp-card">
          <div
            className="student-otp-boxes"
            onPaste={handleOtpPaste}
            data-validation-ignore="true"
            data-validation-field="true"
            data-validation-group="otp"
            data-validation-label="Verification code"
            data-validation-required="true"
            data-validation-value={otpDigits.join("")}
            role="group"
            aria-label="Verification code"
          >
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

          <button disabled={verifyingOtp || loading} className="student-auth-submit">
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
              disabled={resendCooldown > 0 || sendingOtp || verifyingOtp || loading}
            >
              {sendingOtp ? "Sending..." : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        </section>
      </form>
    );
  }

  async function proceedToLogin() {
    if (loading) return;
    setLoading(true);
    setSetupError("");
    try {
      const result = await signOutStudentSetupSession();
      if (result.error) throw new Error("Setup session could not be closed.");
      navigate("/student-login", { replace: true });
    } catch {
      setSetupError("Your account is registered, but we couldn't open login right now. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function renderSuccessStep() {
    return (
      <section className="student-setup-stage student-setup-success" role="status" aria-live="polite">
        {student?.details_verified ? renderIdentityPanel() : null}
        <CheckCircle2 size={34} aria-hidden="true" />
        <h3>Account Successfully Registered</h3>
        <p>Your Kandid account is now ready. You can proceed to login.</p>
        {setupError ? <div className="student-setup-feedback is-error" role="alert"><p>{setupError}</p></div> : null}
        <button type="button" className="student-auth-submit" onClick={proceedToLogin} disabled={loading}>
          {loading ? <KandidButtonLoader label="Opening login..." /> : <>Proceed to Login <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </section>
    );
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      title="Complete account setup"
      copy="Secure your account through the email already recorded for your Student identity."
      backTo="/student-login"
      screenClassName="student-setup-auth-screen"
    >
      <div className="student-auth-card student-setup-card kandid-auth-form-card">
        <SetupProgress step={step} />
        {step === "lookup" ? renderLookupStep() : null}
        {step === "password" && student ? renderPasswordStep() : null}
        {step === "otp" && student ? renderOtpStep() : null}
        {step === "existing" && student ? <section className="student-setup-stage student-setup-success">
          {renderIdentityPanel()}
          <h3>Your account is already active.</h3>
          <p>Proceed to login. If you need password recovery, explicitly confirm below to use the password you entered with this verified email session.</p>
          {setupError ? <div className="student-setup-feedback is-error" role="alert"><p>{setupError}</p></div> : null}
          <button type="button" className="student-auth-submit" onClick={proceedToLogin} disabled={loading}>Proceed to Login</button>
          <button type="button" className="student-auth-setup-link" onClick={completeSetup} disabled={loading}>Confirm verified password recovery</button>
        </section> : null}
        {step === "success" ? renderSuccessStep() : null}
      </div>
    </AuthLayout>
  );
}

export default StudentSetup;
