import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import { getDefaultRouteForUser, getStoredUser } from "../../utils/auth";
import { useEffect } from "react";

function BoardLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "electoral_board") {
      navigate(getDefaultRouteForUser(user), { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("admin_users")
      .select(`
        id,
        email,
        password,
        full_name,
        role,
        status,
        organization_id,
        created_at,
        organizations (
          id,
          name
        )
      `)
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

    if (data.role !== "electoral_board") {
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

    // redirect to board panel
    navigate("/board/dashboard", { replace: true });

    setLoading(false);
  }

  return (
    <AuthLayout
      roleLabel="Electoral Board"
      title="Board Login"
      copy="Sign in to prepare elections, manage students, and monitor voting."
      backTo="/board-portal"
    >
        <form onSubmit={handleLogin} className="student-auth-card kandid-auth-form-card">
          <div className="mt-8 space-y-5">
            <div>
              <label className="field-label">Board Email</label>
              <input
                type="email"
                placeholder="Enter electoral board email"
                required
                autoComplete="username"
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
                autoComplete="current-password"
                className="field-shell w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" disabled={loading} className="primary-btn w-full">
              {loading ? <KandidButtonLoader label="Verifying access..." /> : "Enter Board Workspace"}
            </button>
          </div>
        </form>
    </AuthLayout>
  );
}

export default BoardLogin;
