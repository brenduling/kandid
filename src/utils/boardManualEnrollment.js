import { supabase } from "../lib/supabaseClient";
import { isBoardStudentRegistrationEnabled } from "./boardStudentRegistrationFeatureGate";
import { isBoardStudentManagementEnabled } from "./boardStudentManagementFeatureGate";

const BOARD_MANUAL_ENROLLMENT_FUNCTION = "board-manual-enrollment";

function managementDisabledResult() {
  const error = new Error("Board student management is not activated for this build.");
  error.code = "student_management_not_enabled";
  return { data: null, error };
}

async function resolveFunctionError(result, error) {
  let resolvedError = error || (result?.error ? new Error(result.error) : null);
  let serverCode = cleanServerCode(result?.code);
  if (error?.context?.json) {
    try {
      const payload = await error.context.clone().json();
      resolvedError = new Error(payload?.error || error.message);
      serverCode = cleanServerCode(payload?.code) || serverCode;
    } catch {
      resolvedError = error;
    }
  }

  if (resolvedError && serverCode) {
    resolvedError.code = serverCode;
  }

  return resolvedError || null;
}

// The server only sends short, non-sensitive discriminators so the UI can show a
// specific safe message. It is never used to make an authorization decision.
function cleanServerCode(value) {
  const code = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9_]{1,40}$/.test(code) ? code : "";
}

// Keep the server's safe outcome even when FunctionsHttpError wraps a non-2xx response.
async function invokeBoardRegistration(action, payload) {
  if (["create_new_student_for_term", "enroll_existing_student_for_term"].includes(action) &&
    !isBoardStudentRegistrationEnabled()) {
    return {
      data: { outcome: "REGISTRATION_NOT_ENABLED" },
      error: new Error("Verified Board student registration is not enabled for this build."),
      code: "registration_not_enabled",
      status: 403,
    };
  }
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    { body: { action, ...payload } },
  );
  let response = result;
  if (error?.context?.json) {
    try {
      response = await error.context.clone().json();
    } catch {
      response = null;
    }
  }
  return {
    data: response?.data || null,
    error: error || (response?.error ? new Error(response.error) : null),
    code: response?.code || null,
    status: error?.context?.status || null,
  };
}

export function resolveBoardStudentForTerm(studentNumber) {
  return invokeBoardRegistration("resolve_student_for_term", { student_number: studentNumber });
}

export function registerNewBoardStudentForTerm(student, verification) {
  return invokeBoardRegistration("create_new_student_for_term", {
    student,
    verification_method: verification?.method,
    evidence_reviewed: verification?.evidenceReviewed === true,
  });
}

export function registerExistingBoardStudentForTerm(student, verification) {
  return invokeBoardRegistration("enroll_existing_student_for_term", {
    student,
    verification_method: verification?.method,
    evidence_reviewed: verification?.evidenceReviewed === true,
  });
}

export async function manuallyEnrollBoardStudent(student) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: { student },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    academicTerm: result?.academic_term || null,
    createdStudent: Boolean(result?.created_student),
    createdOrganizationIds: result?.created_organization_ids || [],
    existingOrganizationIds: result?.existing_organization_ids || [],
    error: resolvedError,
  };
}

export async function batchEnrollBoardStudents(rows) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "batch_enroll",
        rows,
      },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    error: resolvedError,
  };
}

export async function previewBoardCsvImport(rows) {
  return invokeBoardCsvImport("preview_board_csv_import", { rows });
}

export async function confirmBoardCsvImport(rows, verification = {}) {
  return invokeBoardCsvImport("confirm_board_csv_import", {
    rows,
    evidence_reviewed: verification.evidenceReviewed === true,
  });
}

async function invokeBoardCsvImport(action, payload) {
  if (action === "confirm_board_csv_import" && !isBoardStudentRegistrationEnabled()) {
    const error = new Error("Verified Board student registration is not enabled for this build.");
    error.code = "registration_not_enabled";
    return { data: null, error, code: error.code, status: 403 };
  }
  let result = null;
  let invokeError;
  try {
    ({ data: result, error: invokeError } = await supabase.functions.invoke(
      BOARD_MANUAL_ENROLLMENT_FUNCTION,
      { body: { action, ...payload } },
    ));
  } catch (error) {
    invokeError = error;
  }

  let response = result;
  if (invokeError?.context?.json) {
    try {
      response = await invokeError.context.clone().json();
    } catch {
      response = result;
    }
  }
  const error = await resolveFunctionError(response, invokeError);
  if (error && Number.isInteger(invokeError?.context?.status)) error.status = invokeError.context.status;
  return {
    data: response?.data || result?.data || null,
    error,
    code: response?.code || error?.code || null,
    status: Number.isInteger(invokeError?.context?.status) ? invokeError.context.status : null,
  };
}

export async function listBoardStudents(options = {}) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "list_students",
        page: options.page,
        page_size: options.pageSize,
        search: options.search,
        sort_by: options.sortBy,
      },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    error: resolvedError,
  };
}

export async function listRemovedBoardStudents(options = {}) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "list_removed_students",
        page: options.page,
        page_size: options.pageSize,
        search: options.search,
        sort_by: options.sortBy,
      },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    error: resolvedError,
  };
}

export async function removeBoardStudentParticipation({
  studentId,
  reason,
  confirmStudentNumber,
  password,
}) {
  if (!isBoardStudentManagementEnabled()) return managementDisabledResult();
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "remove_student_participation",
        student_id: studentId,
        reason,
        confirm_student_number: confirmStudentNumber,
        password,
      },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    error: resolvedError,
  };
}

export async function restoreBoardStudentParticipation({ studentId }) {
  if (!isBoardStudentManagementEnabled()) return managementDisabledResult();
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "restore_student_participation",
        student_id: studentId,
      },
    },
  );

  const resolvedError = await resolveFunctionError(result, error);

  return {
    data: result?.data || null,
    error: resolvedError,
  };
}

export async function updateBoardStudentNames({ studentId, firstName, lastName }) {
  if (!isBoardStudentManagementEnabled()) return managementDisabledResult();
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "update_student_names",
        student_id: studentId,
        changes: { first_name: firstName, last_name: lastName },
      },
    },
  );

  return {
    data: result?.data || null,
    error: await resolveFunctionError(result, error),
  };
}
