import { createClient } from "@supabase/supabase-js";
import { clearSessionCache } from "./sessionCache";
import { guardedSupabaseFetch, supabase } from "../lib/supabaseClient";

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
    logo_url,
    organization_type,
    membership_scope
  )
`;
const LINK_ADMIN_IDENTITY_FUNCTION = "link-admin-identity";
const LINK_STUDENT_IDENTITY_FUNCTION = "link-student-identity";
const RESOLVE_STUDENT_LOGIN_FUNCTION = "resolve-student-login";
const STUDENT_PROFILE_FUNCTION = "student-profile";
// Browser reads of admin_users.password are removed by the release security
// contract. Administrator portals now always require a linked Supabase Auth session.
const ADMIN_AUTH_MODE = "supabase";
const ADMIN_PROFILE_CACHE_MS = 15 * 1000;
const STUDENT_PROFILE_CACHE_MS = 15 * 1000;

const GENERIC_STUDENT_LOGIN_ERROR = "We couldn't sign you in. Check your Student ID and password.";

let adminProfileRequest = null;
let cachedAdminProfile = null;
let cachedAdminProfileAt = 0;
let studentProfileRequest = null;
let cachedStudentProfile = null;
let cachedStudentProfileAt = 0;
let studentSessionGeneration = 0;
let isolatedStudentAuthClientSequence = 0;

function invalidateStudentProfile() {
  studentSessionGeneration += 1;
  studentProfileRequest = null;
  cachedStudentProfile = null;
  cachedStudentProfileAt = 0;
}

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
  invalidateStudentProfile();
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

export async function getCurrentStudentProfile({ force = false, retryAuthRecovery = true } = {}) {
  const generation = studentSessionGeneration;
  const { user, error } = await getCurrentAuthUser();
  // Restoring a persisted Auth session can emit SIGNED_IN while getUser is
  // pending. Revalidate once against the new generation instead of redirecting
  // an authenticated deep link to Login. Never reuse the stale profile/JWT.
  if (generation !== studentSessionGeneration && !error && user?.id && retryAuthRecovery) {
    return getCurrentStudentProfile({ force: true, retryAuthRecovery: false });
  }
  if (generation !== studentSessionGeneration || error || !user?.id) {
    return { data: null, user: null, error: error || new Error("No active Supabase Auth session.") };
  }
  if (!force && cachedStudentProfile?.user?.id === user.id && Date.now() - cachedStudentProfileAt < STUDENT_PROFILE_CACHE_MS) {
    return cachedStudentProfile;
  }

  if (studentProfileRequest?.userId === user.id && studentProfileRequest.generation === generation) return studentProfileRequest.promise;
  const request = { userId: user.id, generation };
  request.promise = resolveCurrentStudentProfile(user, generation).finally(() => {
    if (studentProfileRequest === request) studentProfileRequest = null;
  });
  studentProfileRequest = request;
  return request.promise;
}

async function resolveCurrentStudentProfile(user, generation) {
  const result = await resolveStudentProfileForClient(supabase, user);
  if (generation !== studentSessionGeneration) {
    return { data: null, user: null, error: new Error("The Student session changed. Sign in again.") };
  }
  if (result.error || !result.data) return { ...result, user };
  if (result.data.status !== "active") {
    return { data: null, user, error: new Error("This student account is not available for sign-in.") };
  }
  cachedStudentProfile = result;
  cachedStudentProfileAt = Date.now();
  return { ...result, user };
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
  setupMode = false,
  password,
}) {
  const { data, error } = await supabase.functions.invoke(
    LINK_STUDENT_IDENTITY_FUNCTION,
    {
      body: {
        student_number: studentNumber,
        setup_mode: setupMode,
        password,
      },
    },
  );

  if (error) return { data: null, error };
  if (data?.linked !== true || data.student?.status !== "active" ||
      data.student?.student_number !== studentNumber || !data.student?.id) {
    return {
      data: null,
      error: new Error("Student identity could not be linked."),
    };
  }

  // The authenticated linker confirms the exact active Student mapping. Setup
  // completion must not depend on a separate profile lookup or auto-login.
  return { data: data.student, error: null };
}

export async function signOutStudentSetupSession() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error };
  clearStoredUser();
  return { error: null };
}

async function setStudentPasswordSession(authClient, { studentNumber, password }) {
  const { data, error } = await authClient.functions.invoke(
    RESOLVE_STUDENT_LOGIN_FUNCTION,
    {
      body: {
        action: "login",
        student_number: studentNumber,
        password,
      },
    },
  );

  const session = data?.data?.authenticated ? data.data.session : null;
  if (error || !session?.access_token || !session?.refresh_token) {
    return { data: null, error: error || new Error(GENERIC_STUDENT_LOGIN_ERROR) };
  }
  return authClient.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}

export async function authenticateStudentByNumber(credentials) {
  invalidateStudentProfile();
  return setStudentPasswordSession(supabase, credentials);
}

export async function beginStudentAccessVerification({ studentNumber }) {
  const { data, error } = await supabase.functions.invoke(RESOLVE_STUDENT_LOGIN_FUNCTION, {
    body: { action: "begin_access", student_number: studentNumber },
  });
  if (error || data?.data?.verification_requested !== true) {
    return { data: null, error: error || new Error("Verification could not be requested.") };
  }
  return { data: { verification_requested: true, retry_after_seconds: data.data.retry_after_seconds || 60 }, error: null };
}

export async function inspectStudentSetup({ studentNumber }) {
  const { data, error } = await supabase.functions.invoke(RESOLVE_STUDENT_LOGIN_FUNCTION, {
    body: { action: "inspect_setup", student_number: studentNumber },
  });
  const details = data?.data?.student_details;
  if (error || data?.data?.verification_required !== true || details?.student_number !== studentNumber || details?.details_verified !== false) {
    return { data: null, error: error || new Error("The Student ID check could not be completed. Try again.") };
  }
  // Pre-OTP responses never carry personal details, even from a malformed API.
  return { data: { student_number: studentNumber, details_verified: false }, error: null };
}

export async function verifyStudentAccessCode({ studentNumber, code }) {
  const { data, error } = await supabase.functions.invoke(RESOLVE_STUDENT_LOGIN_FUNCTION, {
    body: {
      action: "verify_access",
      student_number: studentNumber,
      verification_code: code,
    },
  });
  const session = data?.data?.authenticated ? data.data.session : null;
  if (error || !session?.access_token || !session?.refresh_token) {
    return { data: null, error: error || Object.assign(new Error("Verification could not be completed."), { status: 401 }) };
  }
  const result = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (result.error || !result.data?.session) return result;
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  if (identityError || !identity?.user?.email_confirmed_at) {
    return { data: null, error: identityError || Object.assign(new Error("Verified identity required."), { status: 401 }) };
  }
  const details = data?.data?.student_details;
  return { ...result, data: { ...result.data, student_details: details?.details_verified === true && details.student_number === studentNumber ? details : null } };
}

function createIsolatedStudentAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: guardedSupabaseFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `kandid-isolated-kiosk-${++isolatedStudentAuthClientSequence}`,
    },
  });
}

async function resolveStudentProfileForClient(authClient, verifiedUser) {
  const { data: userResult, error: userError } = verifiedUser
    ? { data: { user: verifiedUser }, error: null }
    : await authClient.auth.getUser();
  const user = userResult?.user || null;

  if (userError || !user?.id) {
    return {
      data: null,
      user: null,
      error: userError || new Error("No active Supabase Auth session."),
    };
  }

  const { data: profileResponse, error } = await authClient.functions.invoke(STUDENT_PROFILE_FUNCTION, {
    body: { action: "profile" },
  });
  const data = profileResponse?.data;
  if (error || !data || data.status !== "active") {
    return {
      data: null,
      user,
      error: Object.assign(new Error("Your sign-in succeeded, but your Student profile could not be verified. Try again or contact the Electoral Board."), {
        code: Number(error?.context?.status || error?.status) === 403 ? "STUDENT_PROFILE_FORBIDDEN" : "STUDENT_PROFILE_UNAVAILABLE", cause: error,
      }),
    };
  }
  return { data: { ...data, role: "student" }, user, error: null };
}

export async function authenticateStudentForKiosk({ studentNumber, password }) {
  const normalizedStudentNumber = String(studentNumber || "").trim();
  const kioskClient = createIsolatedStudentAuthClient();
  const { data: authData, error: signInError } = await setStudentPasswordSession(kioskClient, {
    studentNumber: normalizedStudentNumber,
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
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error };
  clearStoredUser();
  return { error: null };
}

// A late profile response must never restore a cache after logout or a switch
// of Auth identity. This callback performs no async Auth calls.
supabase.auth.onAuthStateChange?.((event) => {
  if (event === "SIGNED_OUT") clearStoredUser();
  else if (event === "SIGNED_IN") invalidateStudentProfile();
});

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
