import { supabase } from "../lib/supabaseClient";
import { clearCachedValue, getCachedValue, setCachedValue } from "./sessionCache";

const TERM_CACHE_KEY = "academic-terms";
const CURRENT_TERM_CACHE_KEY = "current-academic-term";
const TERM_CACHE_MS = 60 * 1000;
const TERM_SELECT = "id, academic_year, semester, status, created_at, activated_at, closed_at";
const WRITE_PATH_BLOCKED_MESSAGE =
  "Academic term changes require a linked Supabase Auth Super Admin session and deployed secure Edge Function.";
const ADMIN_ACADEMIC_TERMS_FUNCTION = "admin-academic-terms";

let currentTermRequest = null;
let termsRequest = null;

export const SEMESTERS = ["1st Semester", "2nd Semester"];
export const ACADEMIC_TERM_WRITE_ENABLED = true;
export const ACADEMIC_TERM_WRITE_BLOCKED_REASON = WRITE_PATH_BLOCKED_MESSAGE;

export function isAcademicTermSchemaMissing(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("academic_terms") && message.includes("could not find the table"))
  );
}

export function formatAcademicTerm(term) {
  if (!term) return "No academic term configured";
  return `${term.semester} AY ${term.academic_year}`;
}

export function validateAcademicYear(startYear) {
  const year = Number(startYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return {
      academicYear: "",
      error: "Enter a valid four-digit academic year start.",
    };
  }

  return {
    academicYear: `${year}-${year + 1}`,
    error: "",
  };
}

export function invalidateAcademicTermCache() {
  clearCachedValue(TERM_CACHE_KEY);
  clearCachedValue(CURRENT_TERM_CACHE_KEY);
  currentTermRequest = null;
  termsRequest = null;
}

export async function getCurrentAcademicTerm({ force = false } = {}) {
  if (!force) {
    const cached = getCachedValue(CURRENT_TERM_CACHE_KEY, TERM_CACHE_MS);
    if (cached !== null) return { data: cached, error: null, unavailable: false };
  }

  if (currentTermRequest && !force) return currentTermRequest;

  currentTermRequest = supabase
    .from("academic_terms")
    .select("id, academic_year, semester, status, activated_at")
    .eq("status", "active")
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        if (isAcademicTermSchemaMissing(error)) {
          return { data: null, error: null, unavailable: true };
        }
        return { data: null, error, unavailable: false };
      }

      setCachedValue(CURRENT_TERM_CACHE_KEY, data || null);
      return { data: data || null, error: null, unavailable: false };
    })
    .finally(() => {
      currentTermRequest = null;
    });

  return currentTermRequest;
}

export async function listAcademicTerms({ force = false } = {}) {
  if (!force) {
    const cached = getCachedValue(TERM_CACHE_KEY, TERM_CACHE_MS);
    if (cached) return { data: cached, error: null, unavailable: false };
  }

  if (termsRequest && !force) return termsRequest;

  termsRequest = supabase
    .from("academic_terms")
    .select(TERM_SELECT)
    .abortSignal(AbortSignal.timeout(15000))
    .order("academic_year", { ascending: false })
    .order("semester", { ascending: true })
    .then(({ data, error }) => {
      if (error) {
        if (isAcademicTermSchemaMissing(error)) {
          return { data: [], error: null, unavailable: true };
        }
        return { data: [], error, unavailable: false };
      }

      setCachedValue(TERM_CACHE_KEY, data || []);
      const activeTerm = (data || []).find((term) => term.status === "active") || null;
      setCachedValue(CURRENT_TERM_CACHE_KEY, activeTerm);
      return { data: data || [], error: null, unavailable: false };
    })
    .finally(() => {
      termsRequest = null;
    });

  return termsRequest;
}

export async function createAcademicTerm({ semester, startYear }) {
  if (!ACADEMIC_TERM_WRITE_ENABLED) {
    return { data: null, error: new Error(WRITE_PATH_BLOCKED_MESSAGE) };
  }

  const { error: yearError } = validateAcademicYear(startYear);
  if (yearError) return { data: null, error: new Error(yearError) };
  if (!SEMESTERS.includes(semester)) {
    return { data: null, error: new Error("Choose a supported semester.") };
  }

  return invokeAcademicTermAction({ action: "create", semester, startYear: Number(startYear) });
}

async function invokeAcademicTermAction(body) {
  try {
    const { data: result, error } = await supabase.functions.invoke(ADMIN_ACADEMIC_TERMS_FUNCTION, { body, timeout: 60000 });
    if (error) {
      let details;
      try { details = await error.context?.clone().json(); } catch { /* Network failures have no response body. */ }
      const message = typeof details?.error === "string" ? details.error
        : error.context?.status === 401 ? "Your session expired or the Edge gateway rejected its JWT. Sign in again; verify the deployed authentication contract if this persists."
        : error.context?.status === 404 ? "The academic term Edge Function is not deployed at the configured project."
        : error.name === "FunctionsFetchError" ? "The academic term service could not be reached. Check its deployment, CORS preflight, and your connection. No success was confirmed."
        : error.message || "Academic term service could not be reached.";
      return { data: null, error: { message, status: error.context?.status || 0 } };
    }
    const data = result?.data;
    const isTerm = term => Number.isSafeInteger(term?.id) && term.id > 0 && SEMESTERS.includes(term.semester) && /^\d{4}-\d{4}$/.test(term.academic_year);
    const isReceipt = value => value?.status === "committed" && value.operation_id === body.operationId &&
      isTerm(value.academic_term) && Number.isSafeInteger(value.audit_id) && value.audit_id > 0 &&
      Number.isSafeInteger(value.notification_count) && value.notification_count >= 0 && Number.isFinite(Date.parse(value.committed_at));
    const isReview = value => value?.status === "review" && /^[0-9a-f-]{36}$/i.test(value.operation_id || "") &&
      Number.isFinite(Date.parse(value.expires_at)) && isTerm(value.impact?.source_term) && isTerm(value.impact?.target_term) &&
      value.confirmation_text === `ACTIVATE ${formatAcademicTerm(value.impact.target_term)}` &&
      Array.isArray(value.impact.blockers) && value.impact.blockers.every(reason => typeof reason === "string") &&
      typeof value.impact.can_activate === "boolean" && (!value.impact.can_activate || value.impact.blockers.length === 0) &&
      ["persistent_accounts", "source_enrolled_students", "target_enrolled_students", "active_accounts_requiring_verification",
        "verified_program_shifts", "intended_program_memberships", "intended_institution_memberships", "target_explicit_removals_preserved",
        "conflicting_program_memberships", "blocking_elections", "notification_recipients"].every(key => Number.isSafeInteger(value.impact.counts?.[key]) && value.impact.counts[key] >= 0);
    const valid = body.action === "create" ? isTerm(data) && data.status === "draft" && data.semester === body.semester && data.academic_year === validateAcademicYear(body.startYear).academicYear
      : body.action === "preview" ? isReview(data) && data.impact.target_term.id === body.termId
      : body.action === "activate" ? isReceipt(data)
      : data?.operation_id === body.operationId && (isReceipt(data) || isReview(data));
    if (!data || result?.error || !valid) {
      return { data: null, error: { message: result?.error || "The academic term response could not be verified. Refresh terms or recover the saved operation before retrying.", status: 503 } };
    }
    if (body.action === "create" || data.status === "committed") invalidateAcademicTermCache();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: { message: error.message || "The request was interrupted. Check the transition status before retrying activation.", status: 0 } };
  }
}

export const previewAcademicTerm = termId => invokeAcademicTermAction({ action: "preview", termId: Number(termId) });
export const activateAcademicTerm = ({ operationId, confirmationText }) => invokeAcademicTermAction({ action: "activate", operationId, acknowledged: true, confirmationText });
export const getAcademicTermTransitionStatus = operationId => invokeAcademicTermAction({ action: "transition_status", operationId });
