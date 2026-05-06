import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function StudentLogin() {
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("student_number", studentNumber)
      .single();

    if (error || !data) {
      alert("Student not found. Contact your organization.");
      setLoading(false);
      return;
    }

    // 🚨 STATUS LOGIC
    if (data.status === "pending") {
      alert("Please complete your account setup first.");
      navigate("/student-setup");
      setLoading(false);
      return;
    }

    if (data.status === "disabled") {
      alert("Your account is disabled.");
      setLoading(false);
      return;
    }

    // 🔐 PASSWORD CHECK
    if (data.password !== password) {
      alert("Incorrect password.");
      setLoading(false);
      return;
    }

    // ✅ LOGIN SUCCESS
    const studentSession = {
      ...data,
      role: "student",
    };

    localStorage.setItem("user", JSON.stringify(studentSession));

    navigate("/student/dashboard");
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f3ef]">
      <form
        onSubmit={handleLogin}
        className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-sm"
      >
        <h1 className="text-2xl font-black text-center text-[#ff5a1f]">
          KANDID
        </h1>

        <p className="text-center text-gray-500 text-sm mt-1 mb-6">
          Student Login
        </p>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Student ID Number"
            required
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            className="w-full px-4 py-3 border rounded-xl"
          />

          <input
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border rounded-xl"
          />

          <button
            disabled={loading}
            className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </div>

        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => navigate("/student-setup")}
            className="text-[#ff5a1f] font-semibold hover:underline"
          >
            First time? Setup your account
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          Only registered students can access the system.
        </p>
      </form>
    </div>
  );
}

export default StudentLogin;