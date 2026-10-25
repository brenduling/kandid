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
  formatStudentSetupYearLevel,
} from "../../utils/studentSetupValidation";
import { isStudentAccountSetupEnabled, isVerifiedStudentSetupEnabled } from "../../utils/studentAccountSetupFeatureGate";
import { getStudentSetupLookupFailure } from "../../utils/studentSetupLookupFailure";
import { supabase } from "../../lib/supabaseClient";

const OTP_LENGTH = 6;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

const SETUP_STAGES = [
  { key: "lookup", label: "Student ID", shortLabel: "ID" },
  { key: "otp", label: "Verify OTP", shortLabel: "OTP" },
  { key: "confirm", label: "Confirm information", shortLabel: "Confirm" },
  { key: "password", label: "Configure password", shortLabel: "Password" },
];

const PASSWORD_RULE_LABELS = {
  length: "At least 6 characters",
  letter: "A letter",
  number: "A number",
  special: "A symbol",
};

function SetupProgress({ step }) {
  // Masked-record confirmation belongs to the Student ID phase; the OTP phase
  // starts only once the student confirms and requests the code.
  const activeStep = step === "existing" ? "otp" : step === "recognize" ? "lookup" : step;
  const activeIndex = step === "success" ? SETUP_STAGES.length : SETUP_STAGES.findIndex((stage) => stage.key === activeStep);

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
  const [maskedStudent, setMaskedStudent] = useState(null);
  const [maskedConfirmed, setMaskedConfirmed] = useState(false);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [step, setStep] = useState("lookup");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [lookupFailure, setLookupFailure] = useState(null);
  const [pasteMessage, setPasteMessage] = useState("");
  const [otpNotice, setOtpNotice] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(""));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [setupSubmitted, setSetupSubmitted] = useState(false);
  const lookupRequestRef = useRef(0);
  const setupRequestRef = useRef(0);
  const verificationInFlightRef = useRef(false);
  const dispatchInFlightRef = useRef(false);
  const linkInFlightRef = useRef(false);
  const verifiedIdentityRef = useRef(null);
  const [verificationExpiresAt, setVerificationExpiresAt] = useState(0);
  const recognitionEnabled = isVerifiedStudentSetupEnabled();

  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const passwordValid = passwordChecks.every((check) => check.met);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const otpValue = otpDigits.join("");
  // Before OTP verification only the masked record exists; afterwards the
  // verified full record replaces it. OTP requests always use this number.
  const setupStudentNumber = student?.student_number || maskedStudent?.student_number || "";

  async function loadStudentRecord(number, isActive = () => true) {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    setNotFound(false);
    setSetupError("");
    setLookupFailure(null);
    if (!isVerifiedStudentSetupEnabled()) {
      setSetupError("Student setup is awaiting backend recognition readiness. No lookup or email request has been sent.");
      return;
    }
    const normalized = typeof number === "string" ? number.trim() : "";
    if (!/^[0-9]{1,20}$/.test(normalized)) {
      setNotFound(true);
      return;
    }
    setLoading(true);
    let result;
    try {
      result = await inspectStudentSetup({ studentNumber: normalized });
    } catch (error) {
      result = { error };
    }
    if (!isActive() || lookupRequestRef.current !== requestId) return;
    setLoading(false);
    if (result.error || !result.data) {
      const failure = getStudentSetupLookupFailure(result.error);
      setLookupFailure(failure);
      setSetupError(failure.message);
      return;
    }
    // Show only the server-masked record first. No OTP is requested until the
    // student explicitly confirms the masked record is theirs.
    setStudent(null);
    setMaskedStudent(result.data);
    setMaskedConfirmed(false);
    setDetailsConfirmed(false);
    setOtpNotice("");
    setStep("recognize");
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setPasteMessage("");
  }

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

  const invalidateVerification = useCallback((message) => {
    setupRequestRef.current += 1;
    verifiedIdentityRef.current = null;
    setVerificationExpiresAt(0);
    setStudent(null);
    setMaskedStudent(null);
    setMaskedConfirmed(false);
    setDetailsConfirmed(false);
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setStep("lookup");
    setSetupError(message);
    setLoading(false);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const identity = verifiedIdentityRef.current;
      if (!identity) return;
      if (!session || session.user?.id !== identity.id || session.user?.email?.trim().toLowerCase() !== identity.email) {
        invalidateVerification("Your verification session changed. Request a new code before continuing.");
      } else {
        identity.expiresAt = Math.min(Number(session.expires_at) || 0, identity.proof?.expires_at || Infinity);
        setVerificationExpiresAt(identity.expiresAt);
      }
    });
    return () => { setupRequestRef.current += 1; subscription.unsubscribe(); };
  }, [invalidateVerification]);

  useEffect(() => {
    if (!verifiedIdentityRef.current) return undefined;
    const timer = window.setTimeout(() => invalidateVerification("Your verification session expired. Request a new code before continuing."),
      Math.max(0, verificationExpiresAt * 1000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [verificationExpiresAt, invalidateVerification]);

  function changeStudentId() {
    setSetupSubmitted(false);
    setupRequestRef.current += 1;
    lookupRequestRef.current += 1;
    verifiedIdentityRef.current = null;
    setVerificationExpiresAt(0);
    setStudent(null);
    setMaskedStudent(null);
    setMaskedConfirmed(false);
    setDetailsConfirmed(false);
    setPassword("");
    setConfirmPassword("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setSetupError("");
    setStep("lookup");
  }

  async function handleCheckStudent(event) {
    event.preventDefault();
    if (loading || sendingOtp) return;
    await loadStudentRecord(studentNumber);
  }

  const sendOtp = useCallback(async (number = setupStudentNumber) => {
    if (dispatchInFlightRef.current || resendCooldown > 0 || loading || verifyingOtp) return false;
    setSetupError("");
    if (!number) {
      setSetupError("Find your Student ID record before requesting email verification.");
      return false;
    }
    if (!isStudentAccountSetupEnabled() || !recognitionEnabled) {
      setSetupError("Email verification is awaiting setup readiness. Please contact the Electoral Board before continuing.");
      return false;
    }
    dispatchInFlightRef.current = true;
    const generation = setupRequestRef.current;
    setSendingOtp(true);
    let requestResult;
    try {
      const result = await beginStudentAccessVerification({
        studentNumber: number,
      });
      requestResult = result;
    } catch {
      requestResult = { error: true };
    } finally {
      setSendingOtp(false);
      dispatchInFlightRef.current = false;
    }

    if (setupRequestRef.current !== generation) return false;
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
  }, [setupStudentNumber, resendCooldown, loading, verifyingOtp, recognitionEnabled]);

  async function handlePasswordContinue(event) {
    event.preventDefault();
    setPasteMessage("");
    const validationError = getStudentSetupRequestError({ studentNumber: student?.student_number, passwordValid, passwordsMatch });
    if (validationError || !detailsConfirmed) {
      setSetupError(validationError || "Confirm that the Student details belong to you before continuing.");
      return;
    }
    await completeSetup(verifiedIdentityRef.current?.proof);
  }

  async function completeSetup(proof) {
    if (setupSubmitted || linkInFlightRef.current || loading || !detailsConfirmed || !passwordValid || !passwordsMatch ||
        proof?.account_state !== "pending" || proof.student_number !== student?.student_number ||
        proof.auth_user_id !== verifiedIdentityRef.current?.id) return false;
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    linkInFlightRef.current = true;
    setSetupSubmitted(true);
    setLoading(true);
    setSetupError("");

    try {
      const current = await supabase.auth.getUser();
      if (setupRequestRef.current !== requestId) return false;
      if (current.error || !current.data.user?.email_confirmed_at ||
          current.data.user.id !== verifiedIdentityRef.current?.id ||
          current.data.user.email?.trim().toLowerCase() !== verifiedIdentityRef.current?.email ||
          (verifiedIdentityRef.current?.expiresAt || 0) * 1000 <= Date.now()) {
        invalidateVerification("Your verification session expired or changed. Request a new code before continuing.");
        return false;
      }
      const linkResult = await linkCurrentStudentIdentity({
        studentNumber: student.student_number,
        setupMode: true,
        password,
        setupToken: proof.setup_token,
      });
      if (setupRequestRef.current !== requestId) return false;
      if (linkResult.error || linkResult.data?.status !== "active" || linkResult.data?.student_number !== student.student_number) {
        setSetupError("We couldn't confirm account setup. Contact the Electoral Board before retrying; do not submit your password again.");
        return false;
      }

      setPassword("");
      setConfirmPassword("");
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setPasteMessage("");
      setStep("success");
      return true;
    } catch {
      setSetupError("We couldn't complete account setup because the request failed. Contact the Electoral Board before retrying; the outcome could not be confirmed.");
      return false;
    } finally {
      linkInFlightRef.current = false;
      if (setupRequestRef.current === requestId) setLoading(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    if (verificationInFlightRef.current || loading || sendingOtp) return;
    if (!setupStudentNumber) {
      setSetupError("Enter your Student ID before verifying OTP.");
      return;
    }
    const validationError = getStudentOtpVerificationError({
      code: otpValue,
    });
    if (validationError) {
      setSetupError(validationError);
      return;
    }

    verificationInFlightRef.current = true;
    const requestId = ++setupRequestRef.current;
    setVerifyingOtp(true);
    setSetupError("");
    setOtpNotice("");

    try {
      const verificationResult = await verifyStudentAccessCode({
        studentNumber: setupStudentNumber,
        code: otpValue,
      });
      if (setupRequestRef.current !== requestId) return;
      if (verificationResult?.error || !verificationResult?.data?.session) {
        if (Number(verificationResult?.error?.context?.status || verificationResult?.error?.status) === 429) {
          setResendCooldown(getStudentOtpRetrySeconds(verificationResult.error));
        }
        setSetupError(getStudentOtpFailureMessage(verificationResult?.error));
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        if (verificationResult?.error?.code === "setup_recognition_unavailable" || Number(verificationResult?.error?.context?.status) === 503) {
          setResendCooldown(seconds => Math.max(seconds, 60));
        }
        document.querySelector("[data-student-otp-index='0']")?.focus();
        return;
      }
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setSetupError("");
      const proof = verificationResult.data.setup_verification;
      const verifiedUser = verificationResult.data.user;
      const expiresAt = proof.account_state === "pending"
        ? Math.min(Number(verificationResult.data.session.expires_at), proof.expires_at)
        : Number(verificationResult.data.session.expires_at);
      if (proof?.student_number === setupStudentNumber && proof.auth_user_id === verifiedUser?.id && expiresAt * 1000 > Date.now()) {
        verifiedIdentityRef.current = { id: verifiedUser.id, email: verifiedUser.email.trim().toLowerCase(), expiresAt, proof };
        setVerificationExpiresAt(expiresAt);
        setStudent({student_number:proof.student_number,...proof.student_details});
        setMaskedStudent(null);
        setMaskedConfirmed(false);
        if (proof.account_state === "active") {
          setPassword("");
          setConfirmPassword("");
          setStep("existing");
          return;
        }
        setSetupSubmitted(false);
        setDetailsConfirmed(false);
        setStep("confirm");
        return;
      }
      setSetupError("Verified student information is unavailable. Request a new code after the cooldown.");
      setResendCooldown(seconds => Math.max(seconds, 60));
    } catch {
      setSetupError(getStudentOtpFailureMessage());
    } finally {
      setVerifyingOtp(false);
      verificationInFlightRef.current = false;
    }
  }

  function handleStudentNumberChange(event) {
    lookupRequestRef.current += 1;
    setupRequestRef.current += 1;
    verifiedIdentityRef.current = null;
    setVerificationExpiresAt(0);
    setPassword("");
    setConfirmPassword("");
    setStudentNumber(event.target.value);
    setLoading(false);
    setNotFound(false);
    setSetupError("");
    setStudent(null);
    setMaskedStudent(null);
    setMaskedConfirmed(false);
    setDetailsConfirmed(false);
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
          <h3>Find your Student ID.</h3>
          <p>Enter your Student ID. We will show a partially masked record for you to confirm before a verification code is sent to your registered email.</p>
        </div>

        <div className="student-auth-fields">
          <label>
            <span>Student ID Number</span>
            <input
              id="student-setup-student-id"
              value={studentNumber}
              onChange={handleStudentNumberChange}
              inputMode="numeric"
              autoComplete="username"
              placeholder="e.g. 12345"
            />
          </label>

          <button disabled={loading || sendingOtp || !recognitionEnabled || resendCooldown > 0} className="student-auth-submit">
            {loading || sendingOtp ? <KandidButtonLoader label="Finding record..." /> : <>Find Student ID <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>

        {loading ? (
          <p className="student-setup-operation" role="status">Checking your student record...</p>
        ) : null}

        {!recognitionEnabled ? <p className="student-setup-feedback is-warning" role="status">Student setup is awaiting backend recognition readiness. No lookup or email will be requested until the reviewed contract is enabled.</p> : null}
        {resendCooldown > 0 ? <p role="status">Wait {resendCooldown}s before requesting another code.</p> : null}
        {notFound ? (
          <div className="student-setup-feedback is-warning" role="status">
            <strong>Check your Student ID format.</strong>
            <p>{studentNumber.trim() ? "Use digits only. If you need help, contact the Electoral Board." : "Enter your Student ID using digits only. If you need help, contact the Electoral Board."}</p>
          </div>
        ) : null}
        {setupError ? (
          <div className={`student-setup-feedback ${lookupFailure?.kind === "unavailable" ? "is-blocked" : "is-error"}`} role="alert">
            <strong>{lookupFailure?.title || "Student ID check unavailable"}</strong>
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
    if (!student) return null;
    return <section className="student-setup-identity" aria-label="Read-only Student details">
      <div className="student-setup-section-head"><span>Student details</span><p><ShieldCheck size={14} aria-hidden="true" /> Read only</p></div>
      <dl className="student-setup-identity-grid">
        {[["Student full name", student.full_name || "Not recorded"], ["Program", student.program || "Not recorded"], ["Year level", formatStudentSetupYearLevel(student.year_level)]].map(([label, value]) =>
          <div className="student-setup-identity-item" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>;
  }

  function continueToPassword() {
    if (!student || !detailsConfirmed) {
      setSetupError("Confirm that these Student details belong to you before continuing.");
      return;
    }
    setSetupError("");
    setStep("password");
  }

  function reviewStudentDetails() {
    setPassword("");
    setConfirmPassword("");
    setDetailsConfirmed(false);
    setSetupError("");
    setStep("confirm");
  }

  function renderConfirmationStep() {
    return <section className="student-setup-stage student-setup-flow">
      <div className="student-setup-stage-intro"><h3>Confirm your Student details.</h3><p>Check that this record belongs to you before configuring a password.</p></div>
      {renderIdentityPanel()}
      <label className="student-setup-confirm-ownership">
        <input id="student-setup-confirm-details" type="checkbox" checked={detailsConfirmed} onChange={event => { setDetailsConfirmed(event.target.checked); setSetupError(""); }} />
        <span>I confirm these details belong to me.</span>
      </label>
      {setupError ? <div className="student-setup-feedback is-error" role="alert"><p>{setupError}</p></div> : null}
      <button type="button" className="student-auth-submit" disabled={!detailsConfirmed} onClick={continueToPassword}>Configure Password <ArrowRight size={18} aria-hidden="true" /></button>
      <button type="button" className="student-auth-setup-link" onClick={changeStudentId}>Use a Different Student ID</button>
    </section>;
  }

  function renderMaskedIdentityPanel() {
    if (!maskedStudent) return null;
    const maskedName = [maskedStudent.masked_first_name, maskedStudent.masked_last_name].filter(Boolean).join(" ") || "Not recorded";
    return <section className="student-setup-identity" aria-label="Masked Student record">
      <div className="student-setup-section-head"><span>Record on file</span><p><ShieldCheck size={14} aria-hidden="true" /> Masked</p></div>
      <dl className="student-setup-identity-grid">
        {[["Name on record", maskedName], ["Program", maskedStudent.program || "Not recorded"], ["Year level", formatStudentSetupYearLevel(maskedStudent.year_level)]].map(([label, value]) =>
          <div className="student-setup-identity-item" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>;
  }

  async function confirmMaskedRecord() {
    if (!maskedStudent || sendingOtp || loading) return;
    if (!maskedConfirmed) {
      setSetupError("Confirm that this record belongs to you before we send a verification code.");
      return;
    }
    const generation = lookupRequestRef.current;
    const requested = await sendOtp(maskedStudent.student_number);
    if (lookupRequestRef.current !== generation) return;
    if (requested) setStep("otp");
  }

  function renderRecognizeStep() {
    return <section className="student-setup-stage student-setup-flow">
      <div className="student-setup-stage-intro">
        <h3>Is this your record?</h3>
        <p>For privacy, only part of the name on record is shown. Confirm it is yours and we will send a verification code to the email address registered for this Student ID. Your full details appear only after you verify the code.</p>
      </div>
      {renderMaskedIdentityPanel()}
      <label className="student-setup-confirm-ownership">
        <input id="student-setup-confirm-record" type="checkbox" checked={maskedConfirmed} onChange={event => { setMaskedConfirmed(event.target.checked); setSetupError(""); }} />
        <span>I confirm this record belongs to me.</span>
      </label>
      {setupError ? <div className="student-setup-feedback is-error" role="alert"><p>{setupError}</p></div> : null}
      <button type="button" className="student-auth-submit" disabled={!maskedConfirmed || sendingOtp || loading || resendCooldown > 0} onClick={confirmMaskedRecord}>
        {sendingOtp ? <KandidButtonLoader label="Sending code..." /> : <>Send Verification Code <ArrowRight size={18} aria-hidden="true" /></>}
      </button>
      {resendCooldown > 0 ? <p role="status">Wait {resendCooldown}s before requesting a code.</p> : null}
      <button type="button" className="student-auth-setup-link" onClick={changeStudentId}>Use a Different Student ID</button>
    </section>;
  }

  function renderPasswordStep() {
    return (
      <form noValidate onSubmit={handlePasswordContinue} className="student-setup-stage student-setup-flow student-setup-activation">
        <div className="student-setup-stage-intro">
          <h3>Configure your password.</h3>
          <p>Your email is verified. Choose a password to finish linking this Student account.</p>
        </div>

        <button type="button" className="student-auth-setup-link" disabled={setupSubmitted || sendingOtp || loading} onClick={reviewStudentDetails}>Review Student Details</button>

        <section className="student-setup-password-panel">
          <h4>Secure your access</h4>

          <label className="student-setup-label">
            <span>Password</span>
            <div className="student-auth-password">
              <input
                id="student-setup-new-password"
                disabled={setupSubmitted}
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
                disabled={setupSubmitted}
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

          <button disabled={setupSubmitted || loading || !passwordValid || !passwordsMatch || !detailsConfirmed} className="student-auth-submit">
            {loading ? <KandidButtonLoader label="Completing setup..." /> : <>Complete Account Setup <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
          {sendingOtp ? <p className="student-setup-operation" role="status">Requesting verification using the registered email on file...</p> : null}
        </section>
      </form>
    );
  }

  function renderOtpStep() {
    return (
      <form noValidate onSubmit={verifyOtp} className="student-setup-stage student-setup-flow student-setup-verify">
        <div className="student-setup-stage-intro">
          <h3>Verify your OTP.</h3>
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
            {verifyingOtp || loading ? <KandidButtonLoader label="Checking code..." /> : <>Verify OTP <ArrowRight size={18} aria-hidden="true" /></>}
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
          <button type="button" className="student-auth-setup-link" onClick={changeStudentId} disabled={verifyingOtp || sendingOtp || loading}>Use a Different Student ID</button>
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
      copy="Verify your registered email, confirm your Student details, and configure a password."
      backTo="/student-login"
      screenClassName="student-setup-auth-screen"
    >
      <div className="student-auth-card student-setup-card kandid-auth-form-card">
        <SetupProgress step={step} />
        {step === "lookup" ? renderLookupStep() : null}
        {step === "recognize" && maskedStudent ? renderRecognizeStep() : null}
        {step === "confirm" && student ? renderConfirmationStep() : null}
        {step === "password" && student && detailsConfirmed ? renderPasswordStep() : null}
        {step === "otp" && setupStudentNumber ? renderOtpStep() : null}
        {step === "existing" && student ? <section className="student-setup-stage student-setup-success">
          {renderIdentityPanel()}
          <h3>Your account is already active.</h3>
          <p>Proceed to login. Use the existing recovery option on the login page if you need to recover access.</p>
          {setupError ? <div className="student-setup-feedback is-error" role="alert"><p>{setupError}</p></div> : null}
          <button type="button" className="student-auth-submit" onClick={proceedToLogin} disabled={loading}>Proceed to Login</button>
        </section> : null}
        {step === "success" ? renderSuccessStep() : null}
      </div>
    </AuthLayout>
  );
}

export default StudentSetup;
