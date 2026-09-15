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
    message.includes("academic_terms") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
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

  const { data: result, error } = await supabase.functions.invoke(
    ADMIN_ACADEMIC_TERMS_FUNCTION,
    {
      body: {
        action: "create",
        semester,
        startYear,
      },
    },
  );

  if (!error) invalidateAcademicTermCache();
  return { data: result?.data || null, error };
}

export async function activateAcademicTerm(termId) {
  if (!ACADEMIC_TERM_WRITE_ENABLED) {
    return { data: null, error: new Error(WRITE_PATH_BLOCKED_MESSAGE) };
  }

  const { data: result, error } = await supabase.functions.invoke(
    ADMIN_ACADEMIC_TERMS_FUNCTION,
    {
      body: {
        action: "activate",
        termId: Number(termId),
      },
    },
  );

  if (!error) invalidateAcademicTermCache();
  return { data: result?.data || null, error };
}
