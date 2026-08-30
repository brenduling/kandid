import { supabase } from "../lib/supabaseClient";
import { getStoredUser, setStoredUser } from "./auth";
import { getStudentExplicitOrganizations } from "./organizationAccess";

function getProfileSelect(role) {
  if (role === "student") {
    return `
      *,
      student_organizations (
        organization_id,
        organizations (
          id,
          name,
          logo_url
        )
      )
    `;
  }

  return `
    *,
    organizations (
      id,
      name,
      logo_url
    )
  `;
}

export function getProfileRoute(role) {
  if (role === "super_admin") return "/super-admin/profile";
  if (role === "electoral_board") return "/board/profile";
  return "/student/profile";
}

export async function fetchCurrentUserProfile() {
  const user = getStoredUser();

  if (!user?.role || !user?.id) {
    return { data: null, error: new Error("No active user session.") };
  }

  const table = user.role === "student" ? "students" : "admin_users";
  const { data, error } = await supabase
    .from(table)
    .select(getProfileSelect(user.role))
    .eq("id", user.id)
    .single();

  if (!error && data) {
    const studentOrganizations =
      user.role === "student"
        ? await getStudentExplicitOrganizations(data.id)
        : data.student_organizations;

    const nextUser = {
      ...user,
      ...data,
      role: user.role,
      ...(user.role === "student"
        ? { student_organizations: studentOrganizations }
        : {}),
    };
    setStoredUser(nextUser);
    return { data: nextUser, error: null };
  }

  return { data: null, error };
}

export async function updateCurrentUserProfile(payload) {
  const user = getStoredUser();

  if (!user?.role || !user?.id) {
    return { data: null, error: new Error("No active user session.") };
  }

  const table = user.role === "student" ? "students" : "admin_users";

  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", user.id);

  if (error) {
    return { data: null, error };
  }

  return fetchCurrentUserProfile();
}
