import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Home } from "lucide-react";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "student") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setNotFound(false);
    setAuthError("");

    const { data, error } = await supabase
      .from("students")
      .select(`
        id,
        student_number,
        first_name,
        last_name,
        email,
        password,
        photo_url,
        program,
        year_level,
        precinct_code,
        batch_code,
        is_shs,
        status,
        created_at
      `)
      .eq("student_number", studentNumber)
      .single();

    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    if (data.status === "pending") {
      navigate("/student-setup", { replace: true, state: { studentNumber } });
      setLoading(false);
      return;
    }

    if (data.status === "disabled") {
      setAuthError("Your account is disabled. Please contact the Electoral Board.");
      setLoading(false);
      return;
    }

    if (data.password !== password) {
      setAuthError("Incorrect password. Please check your access code and try again.");
      setLoading(false);
      return;
    }

    localStorage.setItem("user", JSON.stringify({ ...data, role: "student" }));
    navigate("/student/dashboard", { replace: true });
    setLoading(false);
  }

  return (
    <AuthLayout
      roleLabel="Student Portal"
      title="Student Login"
      copy="Sign in to view your organizations, elections, receipts, and results."
      backTo="/"
    >
      <div className="student-auth-card kandid-auth-form-card">
        <form onSubmit={handleLogin} className={notFound ? "student-auth-blur" : ""}>
          <div className="student-auth-fields">
            <label>
              <span>Student ID Number</span>
              <input
                required
                autoComplete="username"
                inputMode="numeric"
                value={studentNumber}
                onChange={(event) => setStudentNumber(event.target.value)}
                placeholder="e.g. 12345"
              />
            </label>

            <label>
              <span className="flex items-center justify-between gap-3">
                Password
                <small>Primary access only?</small>
              </span>
              <div className="student-auth-password">
                <input
                  required
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your secure access code"
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

            {authError ? (
              <div className="student-auth-inline-error">
                <AlertCircle size={18} />
                <span>{authError}</span>
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="student-auth-submit">
              {loading ? <KandidButtonLoader label="Verifying access..." /> : "Login to Vote"}
            </button>
          </div>

          <div className="student-auth-divider">
            <span />
            <p>OR</p>
            <span />
          </div>

          <button
            type="button"
            onClick={() => navigate("/student-setup")}
            className="student-auth-setup-link"
          >
            <span className="student-auth-setup-icon">
              <Home size={16} />
            </span>
            First time here? <strong>Complete account setup</strong>
          </button>
        </form>

        {notFound ? (
          <div className="student-auth-error">
            <div className="student-auth-error-icon">
              <AlertCircle size={20} />
            </div>
            <h3>Student ID not Found!</h3>
            <p>Please see Electoral Board.</p>
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
