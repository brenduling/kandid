import { supabase } from "../lib/supabaseClient";

const BOARD_MANUAL_ENROLLMENT_FUNCTION = "board-manual-enrollment";

async function resolveFunctionError(result, error) {
  let resolvedError = error || (result?.error ? new Error(result.error) : null);
  if (error?.context?.json) {
    try {
      const payload = await error.context.clone().json();
      resolvedError = new Error(payload?.error || error.message);
    } catch {
      resolvedError = error;
    }
  }

  return resolvedError || null;
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
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "preview_board_csv_import",
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

export async function confirmBoardCsvImport(rows) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "confirm_board_csv_import",
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

export async function removeBoardStudentParticipation({ studentId, reason }) {
  const { data: result, error } = await supabase.functions.invoke(
    BOARD_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: {
        action: "remove_student_participation",
        student_id: studentId,
        reason,
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
