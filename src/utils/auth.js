import { createClient } from "@supabase/supabase-js";
import { clearSessionCache } from "./sessionCache";
import { supabase } from "../lib/supabaseClient";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

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
const LINK_STUDENT_IDENTITY_FUNCTION = "link-student-identity";
const RESOLVE_STUDENT_LOGIN_FUNCTION = "resolve-student-login";
const ADMIN_AUTH_MODE = import.meta.env.VITE_KANDID_ADMIN_AUTH_MODE === "supabase"
  ? "supabase"
  : "legacy";
const ADMIN_PROFILE_CACHE_MS = 15 * 1000;
const STUDENT_PROFILE_CACHE_MS = 15 * 1000;

const STUDENT_PROFILE_SELECT = `
  id,
  auth_user_id,
  student_number,
  first_name,
  last_name,
  email,
  photo_url,
  program,
  year_level,
  precinct_code,
  batch_code,
  is_shs,
  status,
  created_at
`;

const GENERIC_STUDENT_LOGIN_ERROR = "We couldn't sign you in. Check your Student ID and password.";

let adminProfileRequest = null;
let cachedAdminProfile = null;
let cachedAdminProfileAt = 0;
let studentProfileRequest = null;
let cachedStudentProfile = null;
let cachedStudentProfileAt = 0;

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
  const previous = getStoredUser();
  if (
    previous?.role !== safeUser.role ||
    String(previous?.id || "") !== String(safeUser.id || "")
  ) {
    clearSessionCache();
  }
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
  studentProfileRequest = null;
  cachedStudentProfile = null;
  cachedStudentProfileAt = 0;
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

export async function getCurrentStudentProfile({ force = false } = {}) {
  if (!force && cachedStudentProfile && Date.now() - cachedStudentProfileAt < STUDENT_PROFILE_CACHE_MS) {
    return cachedStudentProfile;
  }

  if (!force && studentProfileRequest) return studentProfileRequest;

  studentProfileRequest = resolveCurrentStudentProfile().finally(() => {
    studentProfileRequest = null;
  });

  return studentProfileRequest;
}

async function resolveCurrentStudentProfile() {
  const { user, error: userError } = await getCurrentAuthUser();

  if (userError || !user?.id) {
    return {
      data: null,
      user: null,
      error: userError || new Error("No active Supabase Auth session."),
    };
  }

  const { data, error } = await supabase
    .from("students")
    .select(STUDENT_PROFILE_SELECT)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) return { data: null, user, error };
  if (!data) {
    return {
      data: null,
      user,
      error: new Error("No linked KANDID student profile found for this account."),
    };
  }

  if (data.auth_user_id !== user.id) {
    return {
      data: null,
      user,
      error: new Error("Student identity mapping could not be verified."),
    };
  }

  if (data.status !== "active") {
    return {
      data: null,
      user,
      error: new Error("This student account is not available for sign-in."),
    };
  }

  const studentProfile = { ...data, role: "student" };
  const result = { data: studentProfile, user, error: null };
  cachedStudentProfile = result;
  cachedStudentProfileAt = Date.now();
  return result;
}

export async function requireStudentSession({ force = false } = {}) {
  const result = await getCurrentStudentProfile({ force });

  if (result.error || !result.data) {
    return result;
  }

  // Compatibility cache only. Protected student routes verify Supabase Auth
  // and students.auth_user_id before trusting this shape.
  setStoredUser(result.data);
  return result;
}

export async function linkCurrentStudentIdentity({
  studentNumber,
  legacyPassword,
  setupMode = false,
}) {
  const { data, error } = await supabase.functions.invoke(
    LINK_STUDENT_IDENTITY_FUNCTION,
    {
      body: {
        student_number: studentNumber,
        legacy_password: legacyPassword,
        setup_mode: setupMode,
      },
    },
  );

  if (error) return { data: null, error };
  if (!data?.linked) {
    return {
      data: null,
      error: new Error("Student identity could not be linked."),
    };
  }

  return requireStudentSession({ force: true });
}

export async function resolveStudentLogin(studentNumber) {
  const { data, error } = await supabase.functions.invoke(
    RESOLVE_STUDENT_LOGIN_FUNCTION,
    {
      body: {
        student_number: studentNumber,
      },
    },
  );

  if (error) return { data: null, error };
  return { data: data?.data || null, error: null };
}

function createIsolatedStudentAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function resolveStudentProfileForClient(authClient) {
  const { data: userResult, error: userError } = await authClient.auth.getUser();
  const user = userResult?.user || null;

  if (userError || !user?.id) {
    return {
      data: null,
      user: null,
      error: userError || new Error("No active Supabase Auth session."),
    };
  }

  const { data, error } = await authClient
    .from("students")
    .select(STUDENT_PROFILE_SELECT)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) return { data: null, user, error };
  if (!data || data.auth_user_id !== user.id) {
    return {
      data: null,
      user,
      error: new Error(GENERIC_STUDENT_LOGIN_ERROR),
    };
  }

  if (data.status !== "active") {
    return {
      data: null,
      user,
      error: new Error("This student account is not available for sign-in."),
    };
  }

  return { data: { ...data, role: "student" }, user, error: null };
}

export async function authenticateStudentForKiosk({ studentNumber, password }) {
  const normalizedStudentNumber = String(studentNumber || "").trim();
  const { data: loginData, error: resolveError } = await resolveStudentLogin(normalizedStudentNumber);

  if (resolveError || !loginData?.login_email) {
    return { data: null, error: new Error(GENERIC_STUDENT_LOGIN_ERROR) };
  }

  if (loginData.setup_required) {
    return {
      data: null,
      error: new Error("This student still needs to complete account setup."),
    };
  }

  if (!loginData.login_available) {
    return { data: null, error: new Error(GENERIC_STUDENT_LOGIN_ERROR) };
  }

  const kioskClient = createIsolatedStudentAuthClient();
  const { data: authData, error: signInError } = await kioskClient.auth.signInWithPassword({
    email: loginData.login_email,
    password,
  });

  if (signInError || !authData?.session?.access_token) {
    await kioskClient.auth.signOut();
    return { data: null, error: new Error(GENERIC_STUDENT_LOGIN_ERROR) };
  }

  const profileResult = await resolveStudentProfileForClient(kioskClient);
  if (
    profileResult.error ||
    !profileResult.data ||
    String(profileResult.data.student_number) !== normalizedStudentNumber
  ) {
    await kioskClient.auth.signOut();
    return {
      data: null,
      error: profileResult.error || new Error(GENERIC_STUDENT_LOGIN_ERROR),
    };
  }

  return {
    data: {
      student: profileResult.data,
      session: authData.session,
      client: kioskClient,
    },
    error: null,
  };
}

export async function signOutAdminSession() {
  if (isSupabaseAdminAuthMode()) {
    await supabase.auth.signOut();
  }
  clearStoredUser();
}

export async function signOutStudentSession() {
  await supabase.auth.signOut();
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
