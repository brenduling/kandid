import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

function StudentSetup() {
  const [studentNumber, setStudentNumber] = useState("");
  const [student, setStudent] = useState(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleCheckStudent(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("student_number", studentNumber)
      .single();

    if (error || !data) {
      alert("Student ID not found. Please contact the Electoral Board.");
      setLoading(false);
      return;
    }

    if (data.status === "active") {
      alert("Your account is already activated. Please login.");
      window.location.href = "/student-login";
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

  async function handleCompleteSetup(e) {
    e.preventDefault();

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
      .update({
        password: password,
        status: "active",
      })
      .eq("id", student.id);

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    alert("Account setup complete. You can now login.");
    window.location.href = "/student-login";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f3ef] px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">
        <h1 className="text-2xl font-black text-center text-[#ff5a1f]">
          KANDID
        </h1>

        <p className="text-center text-gray-500 text-sm mt-1 mb-6">
          Student Account Setup
        </p>

        {!student ? (
          <form onSubmit={handleCheckStudent} className="space-y-4">
            <div>
              <label className="text-sm font-bold">Student ID Number</label>
              <input
                required
                value={studentNumber}
                onChange={(e) => setStudentNumber(e.target.value)}
                placeholder="Enter your student ID"
                className="w-full mt-1 px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />
            </div>

            <button
              disabled={loading}
              className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17] disabled:opacity-60"
            >
              {loading ? "Checking..." : "Verify Student ID"}
            </button>

            <button
              type="button"
              onClick={() => (window.location.href = "/student-login")}
              className="w-full text-sm text-gray-500 hover:underline"
            >
              Already set up? Login here
            </button>
          </form>
        ) : (
          <form onSubmit={handleCompleteSetup} className="space-y-4">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
              <p className="text-sm text-gray-500">Verified Student</p>
              <h2 className="text-lg font-black">
                {student.first_name} {student.last_name}
              </h2>
              <p className="text-sm text-gray-600">
                {student.student_number}
              </p>
            </div>

            <div>
              <label className="text-sm font-bold">First Name</label>
              <input
                readOnly
                value={student.first_name || ""}
                className="w-full mt-1 px-4 py-3 border rounded-xl bg-gray-100 text-gray-600"
              />
            </div>

            <div>
              <label className="text-sm font-bold">Last Name</label>
              <input
                readOnly
                value={student.last_name || ""}
                className="w-full mt-1 px-4 py-3 border rounded-xl bg-gray-100 text-gray-600"
              />
            </div>

            <div>
              <label className="text-sm font-bold">Email</label>
              <input
                readOnly
                value={student.email || ""}
                className="w-full mt-1 px-4 py-3 border rounded-xl bg-gray-100 text-gray-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-bold">Program</label>
                <input
                  readOnly
                  value={student.program || ""}
                  className="w-full mt-1 px-4 py-3 border rounded-xl bg-gray-100 text-gray-600"
                />
              </div>

              <div>
                <label className="text-sm font-bold">Year Level</label>
                <input
                  readOnly
                  value={student.year_level || ""}
                  className="w-full mt-1 px-4 py-3 border rounded-xl bg-gray-100 text-gray-600"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-bold">Create Password</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create password"
                className="w-full mt-1 px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />
            </div>

            <div>
              <label className="text-sm font-bold">Confirm Password</label>
              <input
                required
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full mt-1 px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />
            </div>

            <button
              disabled={loading}
              className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17] disabled:opacity-60"
            >
              {loading ? "Saving..." : "Complete Setup"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStudent(null);
                setPassword("");
                setConfirmPassword("");
              }}
              className="w-full text-sm text-gray-500 hover:underline"
            >
              Use another Student ID
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default StudentSetup;