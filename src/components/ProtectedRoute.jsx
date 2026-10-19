import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { KandidRouteLoader } from "./KandidLoader";
import {
  getLoginRouteForRole,
  getStoredUser,
  isSupabaseAdminAuthMode,
  requireAdminRole,
  requireStudentSession,
} from "../utils/auth";

function ProtectedRoute({ children, role }) {
  const isStudentRole = role === "student";
  const [adminCheck, setAdminCheck] = useState({
    loading: role === "super_admin" || role === "electoral_board",
    user: null,
  });
  const [studentCheck, setStudentCheck] = useState({
    loading: isStudentRole,
    user: null,
  });
  const [studentRetry, setStudentRetry] = useState(0);
  const user = getStoredUser();
  const isAdminRole = role === "super_admin" || role === "electoral_board";
  const shouldVerifyAdminWithSupabase = isAdminRole && isSupabaseAdminAuthMode();

  useEffect(() => {
    if (!shouldVerifyAdminWithSupabase) return undefined;

    let active = true;

    async function verifyAdminRoute() {
      const result = await requireAdminRole(role, {
        requireOrganization: role === "electoral_board",
      });

      if (!active) return;

      setAdminCheck({
        loading: false,
        user: result.data || null,
      });
    }

    verifyAdminRoute();

    return () => {
      active = false;
    };
  }, [shouldVerifyAdminWithSupabase, role]);

  useEffect(() => {
    if (!isStudentRole) return undefined;

    let active = true;

    async function verifyStudentRoute() {
      const result = await requireStudentSession().catch(() => ({ data: null, error: { code: "STUDENT_PROFILE_UNAVAILABLE" } }));

      if (!active) return;

      setStudentCheck({
        loading: false,
        user: result.data || null,
        error: result.error,
      });
    }

    verifyStudentRoute();

    return () => {
      active = false;
    };
  }, [isStudentRole, studentRetry]);

  if (shouldVerifyAdminWithSupabase) {
    if (adminCheck.loading) {
      return <KandidRouteLoader message={role === "electoral_board" ? "Checking Electoral Board access..." : "Checking system administration access..."} />;
    }

    if (!adminCheck.user) {
      return <Navigate to={getLoginRouteForRole(role)} replace />;
    }

    return children;
  }

  if (isStudentRole) {
    if (studentCheck.loading) {
      return <KandidRouteLoader message="Checking your Student Portal access..." />;
    }

    if (!studentCheck.user) {
      if (studentCheck.error?.code === "STUDENT_PROFILE_UNAVAILABLE") {
        return <div role="alert" className="student-setup-feedback is-error">
          <p>Your Student profile is temporarily unavailable. Your session has not been signed out.</p>
          <button type="button" onClick={() => {
            setStudentCheck({ loading: true, user: null });
            setStudentRetry((current) => current + 1);
          }}>Try again</button>
        </div>;
      }
      return <Navigate to={getLoginRouteForRole(role)} replace />;
    }

    return children;
  }

  if (!user) {
    return <Navigate to={getLoginRouteForRole(role)} replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={getLoginRouteForRole(user.role)} replace />;
  }

  return children;
}

export default ProtectedRoute;
