import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, Home } from "lucide-react";
import StudentAuthShell from "../../components/StudentAuthShell";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
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
      alert("Your account is disabled.");
      setLoading(false);
      return;
    }

    if (data.password !== password) {
      alert("Incorrect password.");
      setLoading(false);
      return;
    }

    localStorage.setItem("user", JSON.stringify({ ...data, role: "student" }));
    navigate("/student/dashboard", { replace: true });
    setLoading(false);
  }

  return (
    <StudentAuthShell>
      <div className="student-auth-card">
        <form onSubmit={handleLogin} className={notFound ? "student-auth-blur" : ""}>
          <h2>Student Login</h2>
          <p className="student-auth-subcopy">
            Only registered students with active organization-linked accounts can
            access the portal.
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

            <label>
              <span className="flex items-center justify-between gap-3">
                Password
                <small>Primary access only?</small>
              </span>
              <div className="student-auth-password">
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your secure access code"
                />
                <Eye size={15} />
              </div>
            </label>

            <button disabled={loading} className="student-auth-submit">
              {loading ? "Authenticating..." : "Authenticate Student Identity"}
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

      <footer className="student-auth-footer">
        <span>Blockchain secured</span>
        <span>End-to-end encrypted</span>
      </footer>
    </StudentAuthShell>
  );
}

export default StudentLogin;
