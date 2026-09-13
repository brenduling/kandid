import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "../../components/AuthLayout";
import { KandidButtonLoader } from "../../components/KandidLoader";
import { supabase } from "../../lib/supabaseClient";
import {
  getAdminAuthMode,
  getDefaultRouteForUser,
  getStoredUser,
  isSupabaseAdminAuthMode,
  linkCurrentAdminIdentity,
  requireAdminRole,
  signOutAdminSession,
} from "../../utils/auth";
import { useEffect } from "react";

async function getIdentityLinkErrorMessage(error) {
  if (!error) return "Unable to link this verified admin account.";

  if (error.context?.json) {
    try {
      const payload = await error.context.clone().json();
      if (payload?.error) return payload.error;
    } catch {
      // Fall through to the SDK error message.
    }
  }

  return error.message || "Unable to link this verified admin account.";
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function redirectLinkedSession() {
      if (!isSupabaseAdminAuthMode()) {
        const user = getStoredUser();
        if (active && user?.role === "super_admin") {
          navigate(getDefaultRouteForUser(user), { replace: true });
        }
        return;
      }

      const { data } = await requireAdminRole("super_admin");
      if (active && data) {
        navigate(getDefaultRouteForUser(data), { replace: true });
      }
    }

    redirectLinkedSession();

    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    if (getAdminAuthMode() === "legacy") {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, email, password, full_name, role, status, created_at, photo_url")
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

      const safeUser = { ...data };
      delete safeUser.password;
      localStorage.setItem("user", JSON.stringify(safeUser));
      navigate("/super-admin/dashboard", { replace: true });
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      alert("Invalid email or password");
      setLoading(false);
      return;
    }

    let { data, error } = await requireAdminRole("super_admin");

    if (error || !data) {
      const linkResult = await linkCurrentAdminIdentity();
      if (linkResult.error) {
        const message = await getIdentityLinkErrorMessage(linkResult.error);
        await signOutAdminSession();
        alert(message);
        setLoading(false);
        return;
      }

      const linked = await requireAdminRole("super_admin");
      data = linked.data;
      error = linked.error;
    }

    if (error || !data) {
      await signOutAdminSession();
      alert(error?.message || "Unauthorized access");
      setLoading(false);
      return;
    }

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
                autoComplete="username"
                className="field-shell w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Password</label>
              <div className="student-auth-password">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  required
                  autoComplete="current-password"
                  className="field-shell w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
