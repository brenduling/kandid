import { supabase } from "../lib/supabaseClient";
import {
  getCurrentAdminProfile,
  getStoredUser,
  isSupabaseAdminAuthMode,
  setStoredUser,
} from "./auth";
import { updateCurrentAdminProfile } from "./adminUsers";
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
    id,
    auth_user_id,
    email,
    full_name,
    role,
    status,
    organization_id,
    photo_url,
    created_at,
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

  if (
    isSupabaseAdminAuthMode() &&
    (user.role === "super_admin" || user.role === "electoral_board")
  ) {
    const { data, error } = await getCurrentAdminProfile({ force: true });
    if (error || !data) return { data: null, error };

    const nextUser = {
      ...user,
      ...data,
      role: data.role,
    };
    setStoredUser(nextUser);
    return { data: nextUser, error: null };
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

  if (
    isSupabaseAdminAuthMode() &&
    (user.role === "super_admin" || user.role === "electoral_board")
  ) {
    const allowedPayload = {
      full_name: payload.full_name,
      photo_url: payload.photo_url,
    };
    const { data, error } = await updateCurrentAdminProfile(allowedPayload);

    if (error) return { data: null, error };

    const nextUser = {
      ...user,
      ...data,
      role: user.role,
    };
    setStoredUser(nextUser);
    return { data: nextUser, error: null };
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
