import { supabase } from "../lib/supabaseClient";
import {
  getCurrentAdminProfile,
  getCurrentStudentProfile,
  getStoredUser,
  setStoredUser,
} from "./auth";
import { updateCurrentAdminProfile } from "./adminUsers";
import { getStudentCurrentMemberships } from "./organizationAccess";

const STUDENT_PROFILE_FUNCTION = "student-profile";

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

  if (user.role === "super_admin" || user.role === "electoral_board") {
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

  if (user.role === "student") {
    const { data, error } = await getCurrentStudentProfile({ force: true });
    if (error || !data) return { data: null, error };

    const studentOrganizations = await getStudentCurrentMemberships(data);
    const nextUser = {
      ...data,
      current_organization_memberships: studentOrganizations,
    };
    setStoredUser(nextUser);
    return { data: nextUser, error: null };
  }

  return { data: null, error: new Error("The authenticated profile is unavailable.") };
}

export async function updateCurrentUserProfile(payload) {
  const user = getStoredUser();

  if (!user?.role || !user?.id) {
    return { data: null, error: new Error("No active user session.") };
  }

  if (user.role === "super_admin" || user.role === "electoral_board") {
    const allowedPayload = {
      ...(user.role !== "electoral_board" && payload.full_name !== undefined
        ? { full_name: payload.full_name }
        : {}),
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

  if (user.role === "student") {
    const { data: currentStudent, error: sessionError } = await getCurrentStudentProfile({ force: true });
    if (sessionError || !currentStudent) {
      return { data: null, error: sessionError || new Error("No active student session.") };
    }

    if (payload.password) {
      const { error: passwordError } = await supabase.auth.updateUser({
        password: payload.password,
      });
      if (passwordError) {
        return { data: null, error: passwordError };
      }
    }

    let emailChangePending = false;
    const requestedEmail = String(payload.email || "").trim().toLowerCase();
    const currentEmail = String(currentStudent.email || "").trim().toLowerCase();
    if (requestedEmail && requestedEmail !== currentEmail) {
      const { error: emailError } = await supabase.auth.updateUser({ email: requestedEmail });
      if (emailError) return { data: null, error: emailError };
      emailChangePending = true;
    }

    if (payload.photo_url !== undefined && payload.photo_url !== currentStudent.photo_url) {
      const { error: photoError } = await supabase.functions.invoke(STUDENT_PROFILE_FUNCTION, {
        body: { action: "update_photo", photo_url: payload.photo_url || null },
      });
      if (photoError) return { data: null, error: photoError };
    }

    const refreshed = await fetchCurrentUserProfile();
    return { ...refreshed, emailChangePending };
  }

  return { data: null, error: new Error("This account cannot update that profile.") };
}
