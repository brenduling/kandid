import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";
import { useEffect } from "react";

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "super_admin") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("admin_users")
      .select("id, email, password, full_name, role, status, created_at")
      .eq("email", email)
      .single();

    if (error || !data) {
      alert("Invalid email");
      setLoading(false);
      return;
    }

    if (data.password !== password) {
      alert("Incorrect password");
      setLoading(false);
      return;
    }

    if (data.role !== "super_admin") {
      alert("Unauthorized access");
      setLoading(false);
      return;
    }

    if (data.status !== "active") {
      alert("Account is disabled");
      setLoading(false);
      return;
    }

    // save session
    localStorage.setItem("user", JSON.stringify(data));

    // redirect
    navigate("/super-admin/dashboard", { replace: true });

    setLoading(false);
  }

  return (
    <AuthLayout
      roleLabel="Super Admin"
      title="Admin Login"
      copy="Sign in to manage organizations, elections, access, and oversight."
      backTo="/admin"
    >
        <form onSubmit={handleLogin} className="student-auth-card kandid-auth-form-card">
          <div className="mt-8 space-y-5">
            <div>
              <label className="field-label">Admin Email</label>
              <input
                type="email"
                placeholder="Enter super admin email"
                required
                className="field-shell w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Password</label>
              <input
                type="password"
                placeholder="Enter password"
                required
                className="field-shell w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" disabled={loading} className="primary-btn w-full">
              {loading ? <KandidButtonLoader label="Verifying access..." /> : "Access Super Admin Console"}
            </button>
          </div>
        </form>
    </AuthLayout>
  );
}

export default AdminLogin;
