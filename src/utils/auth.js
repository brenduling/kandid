import { clearSessionCache } from "./sessionCache";
import { supabase } from "../lib/supabaseClient";

const ADMIN_PROFILE_SELECT = `
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
const LINK_ADMIN_IDENTITY_FUNCTION = "link-admin-identity";
const ADMIN_AUTH_MODE = import.meta.env.VITE_KANDID_ADMIN_AUTH_MODE === "supabase"
  ? "supabase"
  : "legacy";
const ADMIN_PROFILE_CACHE_MS = 15 * 1000;

let adminProfileRequest = null;
let cachedAdminProfile = null;
let cachedAdminProfileAt = 0;

export function getAdminAuthMode() {
  return ADMIN_AUTH_MODE;
}

export function isSupabaseAdminAuthMode() {
  return ADMIN_AUTH_MODE === "supabase";
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  const safeUser = { ...(user || {}) };
  delete safeUser.password;
  localStorage.setItem("user", JSON.stringify(safeUser));
  window.dispatchEvent(
    new CustomEvent("kandid-user-updated", {
      detail: safeUser,
    }),
  );
}

export function clearStoredUser() {
  localStorage.removeItem("user");
  sessionStorage.removeItem("kandid-login-email");
  sessionStorage.removeItem("kandid-login-student-number");
  sessionStorage.removeItem("kandid-login-password");
  localStorage.removeItem("kandid-login-email");
  localStorage.removeItem("kandid-login-student-number");
  localStorage.removeItem("kandid-login-password");
  clearSessionCache();
  adminProfileRequest = null;
  cachedAdminProfile = null;
  cachedAdminProfileAt = 0;
  window.dispatchEvent(new CustomEvent("kandid-user-updated", { detail: null }));
}

export async function getCurrentAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  return { user: data?.user || null, error };
}

export async function getCurrentAdminProfile({ force = false } = {}) {
  if (!force && cachedAdminProfile && Date.now() - cachedAdminProfileAt < ADMIN_PROFILE_CACHE_MS) {
    return cachedAdminProfile;
  }

  if (!force && adminProfileRequest) return adminProfileRequest;

  adminProfileRequest = resolveCurrentAdminProfile().finally(() => {
    adminProfileRequest = null;
  });

  return adminProfileRequest;
}

async function resolveCurrentAdminProfile() {
  const { user, error: userError } = await getCurrentAuthUser();

  if (userError || !user?.id) {
    return {
      data: null,
      user: null,
      error: userError || new Error("No active Supabase Auth session."),
    };
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select(ADMIN_PROFILE_SELECT)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) return { data: null, user, error };
  if (!data) {
    return {
      data: null,
      user,
      error: new Error("No linked KANDID admin profile found for this account."),
    };
  }

  if (data.auth_user_id !== user.id) {
    return {
      data: null,
      user,
      error: new Error("Admin identity mapping could not be verified."),
    };
  }

  const result = { data, user, error: null };
  cachedAdminProfile = result;
  cachedAdminProfileAt = Date.now();
  return result;
}

export async function requireAdminRole(role, { requireOrganization = false } = {}) {
  const { data, user, error } = await getCurrentAdminProfile();

  if (error || !data) return { data: null, user, error };

  if (data.role !== role) {
    return {
      data: null,
      user,
      error: new Error("This authenticated account is not authorized for this portal."),
    };
  }

  if (data.status !== "active") {
    return {
      data: null,
      user,
      error: new Error("This account is disabled."),
    };
  }

  if (requireOrganization && !data.organization_id) {
    return {
      data: null,
      user,
      error: new Error("This board account is not assigned to an organization."),
    };
  }

  setStoredUser(data);
  return { data, user, error: null };
}

export async function linkCurrentAdminIdentity() {
  const { data: result, error } = await supabase.functions.invoke(
    LINK_ADMIN_IDENTITY_FUNCTION,
    { body: {} },
  );

  return { data: result?.data || null, error };
}

export async function signOutAdminSession() {
  if (isSupabaseAdminAuthMode()) {
    await supabase.auth.signOut();
  }
  clearStoredUser();
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
  if (role === "electoral_board") return "/eb-login";
  if (role === "student") return "/student-login";
  return "/admin-login";
}
