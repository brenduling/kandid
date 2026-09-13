import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { KandidRouteLoader } from "./KandidLoader";
import {
  getLoginRouteForRole,
  getStoredUser,
  isSupabaseAdminAuthMode,
  requireAdminRole,
} from "../utils/auth";

function ProtectedRoute({ children, role }) {
  const [adminCheck, setAdminCheck] = useState({
    loading: role === "super_admin" || role === "electoral_board",
    user: null,
  });
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

  if (shouldVerifyAdminWithSupabase) {
    if (adminCheck.loading) {
      return <KandidRouteLoader message="Verifying secure session..." />;
    }

    if (!adminCheck.user) {
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
