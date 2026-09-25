import { supabase } from "../lib/supabaseClient";

const SUPER_ADMIN_MANUAL_ENROLLMENT_FUNCTION = "super-admin-manual-enrollment";

async function invokeManualEnrollment(body) {
  const { data: result, error } = await supabase.functions.invoke(
    SUPER_ADMIN_MANUAL_ENROLLMENT_FUNCTION,
    {
      body,
    },
  );

  let response = result;
  let resolvedError = error || (result?.error ? new Error(result.error) : null);
  if (error?.context?.json) {
    try {
      response = await error.context.clone().json();
      resolvedError = new Error(response?.error || error.message);
    } catch {
      resolvedError = error;
    }
  }

  return { response, error: resolvedError };
}

export async function resolveSuperAdminStudentForTerm(studentNumber) {
  const { response, error } = await invokeManualEnrollment({
    action: "resolve_student_for_term",
    student_number: studentNumber,
  });

  return { data: response?.data || null, error };
}

export async function registerNewSuperAdminStudent(student) {
  const { response, error } = await invokeManualEnrollment({
    action: "create_new_student_for_term",
    student,
  });

  return { data: response?.data || null, error };
}

export async function enrollExistingSuperAdminStudent(student) {
  const { response, error } = await invokeManualEnrollment({
    action: "enroll_existing_student_for_term",
    student,
  });

  return { data: response?.data || null, error };
}

export async function manuallyEnrollSuperAdminStudent(student) {
  const { response: result, error: resolvedError } = await invokeManualEnrollment({ student });

  return {
    data: result?.data || null,
    academicTerm: result?.academic_term || null,
    createdStudent: Boolean(result?.created_student),
    createdOrganizationIds: result?.created_organization_ids || [],
    existingOrganizationIds: result?.existing_organization_ids || [],
    error: resolvedError,
  };
}
