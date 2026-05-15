import { Navigate } from "react-router-dom";
import { getLoginRouteForRole, getStoredUser } from "../utils/auth";

function ProtectedRoute({ children, role }) {
  const user = getStoredUser();

  if (!user) {
    return <Navigate to={getLoginRouteForRole(role)} replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={getLoginRouteForRole(user.role)} replace />;
  }

  return children;
}

export default ProtectedRoute;
