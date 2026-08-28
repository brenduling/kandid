import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, Home, Mail, UserRound } from "lucide-react";
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

  async function handleCompleteSetup(event) {
    event.preventDefault();

    if (password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("students")
      .update({ password, status: "active" })
      .eq("id", student.id);

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    const { error: linkError } = await syncStudentOrganizationMemberships({
      studentId: student.id,
      program: student.program,
    });

    if (linkError) {
      console.error("Failed to link student to organizations:", linkError);
      alert(linkError.message || "Failed to associate student with organizations.");
    }

    navigate("/student-login", { replace: true });
  }
  async function handleCheckStudent(event) {
    event.preventDefault();
    setLoading(true);
    setNotFound(false);

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
      alert("Your account is disabled. Please contact the Electoral Board.");
      setLoading(false);
      return;
    }

    setStudent(data);
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
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="e.g. brendulinmaharliakatibapa"
                />
                <Eye size={14} />
              </div>
            </label>

            <label className="student-setup-label">
              <span>Confirm Password</span>
              <div className="student-auth-password">
                <input
                  required
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="e.g. brendulinmaharliakatibapa"
                />
                <Eye size={14} />
              </div>
            </label>

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
