export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem("user");
}

export function getDefaultRouteForUser(user) {
  if (!user) return "/";
  if (user.role === "super_admin") return "/super-admin/dashboard";
  if (user.role === "electoral_board") return "/board/dashboard";
  if (user.role === "student") return "/student/dashboard";
  return "/";
}

export function getLoginRouteForRole(role) {
  if (role === "super_admin") return "/admin-login";
  if (role === "electoral_board") return "/board-login";
  if (role === "student") return "/student-login";
  return "/admin-login";
}
