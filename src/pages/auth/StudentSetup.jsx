import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Home, Mail, UserRound } from "lucide-react";
import StudentAuthShell from "../../components/StudentAuthShell";
import { supabase } from "../../lib/supabaseClient";
import { syncStudentOrganizationMemberships } from "../../utils/organizationAccess";

function StudentSetup() {
  const location = useLocation();
  const navigate = useNavigate();
  const [studentNumber, setStudentNumber] = useState(
    location.state?.studentNumber || "",
  );
  const [student, setStudent] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  function friendlyAuthError(error, fallback) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("rate")) return "Please wait before requesting another verification code.";
    if (message.includes("expired")) return "That verification code has expired. Request a new code.";
    if (message.includes("invalid")) return "That verification code is invalid. Check the email and try again.";
    return fallback;
  }

  async function sendOtp() {
    if (!student?.email) {
      setSetupError("This student record has no email address. Ask the Electoral Board to add one first.");
      return;
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

    if (error) {
      setSetupError(friendlyAuthError(error, "We could not send the verification code. Please try again."));
      setSendingOtp(false);
      return;
    }

    setOtpSent(true);
    setSendingOtp(false);
  }

  async function verifyOtp() {
    const token = otp.trim();
    if (!token) {
      setSetupError("Enter the verification code sent to your email.");
      return;
    }

    setVerifyingOtp(true);
    setSetupError("");

    const { error } = await supabase.auth.verifyOtp({
      email: student.email,
      token,
      type: "email",
    });

    if (error) {
      setSetupError(friendlyAuthError(error, "We could not verify that code. Please try again."));
      setVerifyingOtp(false);
      return;
    }

    setOtpVerified(true);
    setVerifyingOtp(false);
    await supabase.auth.signOut();
  }

  async function handleCompleteSetup(event) {
    event.preventDefault();
    setSetupError("");

    if (password.length < 6) {
      setSetupError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setSetupError("Passwords do not match.");
      return;
    }

    if (!otpVerified) {
      setSetupError("Verify your email before completing account setup.");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("students")
      .update({ password, status: "active" })
      .eq("id", student.id);

    if (error) {
      setSetupError("We could not complete your account setup. Please try again.");
      setLoading(false);
      return;
    }

    const { error: linkError } = await syncStudentOrganizationMemberships({
      studentId: student.id,
      program: student.program,
    });

    if (linkError) {
      console.error("Failed to link student to organizations:", linkError);
      setSetupError("Your account was activated, but organization syncing needs to be retried by the Electoral Board.");
      setLoading(false);
      return;
    }

    navigate("/student-login", { replace: true });
  }
  async function handleCheckStudent(event) {
    event.preventDefault();
    setLoading(true);
    setNotFound(false);
    setSetupError("");

    const { data, error } = await supabase
      .from("students")
      .select("id, student_number, first_name, last_name, email, program, year_level, status")
      .eq("student_number", studentNumber)
      .single();

    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    if (data.status === "active") {
      navigate("/student-login", { replace: true });
      return;
    }

    if (data.status === "disabled") {
      setSetupError("Your account is disabled. Please contact the Electoral Board.");
      setLoading(false);
      return;
    }

    setStudent(data);
    setOtpSent(false);
    setOtp("");
    setOtpVerified(false);
    setLoading(false);
  }



  return (
    <StudentAuthShell>
      <div className="student-auth-card student-setup-card">
        {!student ? (
          <form onSubmit={handleCheckStudent}>
            <h2>Student Login</h2>
            <p className="student-auth-subcopy">
              Welcome back. Please enter your credentials to securely access
              your student organization dashboard.
            </p>

            <div className="student-auth-fields">
              <label>
                <span>Student ID Number</span>
                <input
                  required
                  value={studentNumber}
                  onChange={(event) => setStudentNumber(event.target.value)}
                  placeholder="e.g. 12345"
                />
              </label>

              <button disabled={loading} className="student-auth-submit">
                {loading ? "Verifying..." : "Verify Student ID"}
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
                Student ID not found. Please see Electoral Board.
              </p>
            ) : null}
            {setupError ? (
              <div className="student-auth-inline-error mt-5">
                <AlertCircle size={18} />
                <span>{setupError}</span>
              </div>
            ) : null}
          </form>
        ) : (
          <form onSubmit={handleCompleteSetup}>
            <h2 className="text-center">Student Set up</h2>

            <div className="student-verified-id">
              <strong>{student.student_number}</strong>
              <span>Verified Student</span>
            </div>

            <div className="student-setup-grid">
              <label>
                <span>Last Name</span>
                <div className="student-auth-password">
                  <input readOnly value={student.last_name || ""} />
                  <UserRound size={14} />
                </div>
              </label>

              <label>
                <span>First Name</span>
                <div className="student-auth-password">
                  <input readOnly value={student.first_name || ""} />
                  <UserRound size={14} />
                </div>
              </label>
            </div>

            <label className="student-setup-label">
              <span>Email Address *</span>
              <div className="student-auth-password">
                <input readOnly value={student.email || ""} />
                <Mail size={14} />
              </div>
            </label>

            <div className="student-setup-grid">
              <label>
                <span>Program</span>
                <input readOnly value={student.program || ""} />
              </label>

              <label>
                <span>Year Level</span>
                <input readOnly value={student.year_level || ""} />
              </label>
            </div>

            <label className="student-setup-label">
              <span>Create Password</span>
              <div className="student-auth-password">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="e.g. brendulinmaharliakatibapa"
                />
                <button
                  type="button"
                  className="student-auth-eye-btn"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <label className="student-setup-label">
              <span>Confirm Password</span>
              <div className="student-auth-password">
                <input
                  required
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="e.g. brendulinmaharliakatibapa"
                />
                <button
                  type="button"
                  className="student-auth-eye-btn"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <div className="student-auth-otp-panel">
              <div>
                <span>Email Verification</span>
                <p>
                  {otpVerified
                    ? "Email verified. You can complete setup."
                    : otpSent
                      ? `Enter the code sent to ${student.email}.`
                      : `Send a verification code to ${student.email}.`}
                </p>
              </div>

              {!otpVerified ? (
                <>
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={sendingOtp || verifyingOtp}
                    className="student-auth-otp-action"
                  >
                    {sendingOtp ? "Sending..." : otpSent ? "Resend Code" : "Send Code"}
                  </button>

                  {otpSent ? (
                    <div className="student-auth-password mt-3">
                      <input
                        value={otp}
                        onChange={(event) => setOtp(event.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="Enter email code"
                      />
                      <button
                        type="button"
                        className="student-auth-otp-verify"
                        onClick={verifyOtp}
                        disabled={verifyingOtp}
                      >
                        {verifyingOtp ? "Checking..." : "Verify"}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {setupError ? (
              <div className="student-auth-inline-error mt-5">
                <AlertCircle size={18} />
                <span>{setupError}</span>
              </div>
            ) : null}

            <button disabled={loading} className="student-auth-submit mt-6">
              {loading ? "Saving..." : "Complete Set Up"}
            </button>
          </form>
        )}
      </div>
    </StudentAuthShell>
  );
}

export default StudentSetup;
