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

export async function unenrollSuperAdminStudentForCurrentTerm(studentId) {
  const { response, error } = await invokeManualEnrollment({
    action: "unenroll_student_for_current_term",
    student_id: Number(studentId),
  });
  return { data: response?.data || null, error };
}

export async function removeSuperAdminCurrentOrganizationMembership({
  studentId,
  organizationId,
  reason,
}) {
  const { response, error } = await invokeManualEnrollment({
    action: "remove_current_organization_membership",
    student_id: Number(studentId),
    organization_id: Number(organizationId),
    reason,
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

export async function updateSuperAdminStudent(studentId, student) {
  const { response, error } = await invokeManualEnrollment({
    action: "update_student",
    student_id: Number(studentId),
    student,
  });
  return { data: response?.data || null, error };
}

export async function getSuperAdminStudentDeletionReadiness(studentId) {
  const { response, error } = await invokeManualEnrollment({
    action: "student_deletion_readiness",
    student_id: Number(studentId),
  });
  return { data: response?.data || null, error };
}

export async function deleteSuperAdminStudent(studentId) {
  const { response, error } = await invokeManualEnrollment({
    action: "delete_student",
    student_id: Number(studentId),
    confirmed: true,
  });
  return { data: response?.data || null, error };
}

export async function listSuperAdminStudents({ search, status, studentIds, sort, page, pageSize } = {}) {
  const { response, error } = await invokeManualEnrollment({
    action: "list_students",
    search,
    status,
    student_ids: studentIds,
    sort,
    page,
    page_size: pageSize,
  });
  return { data: response?.data || null, error };
}

export async function listSuperAdminStudentReport() {
  const { response, error } = await invokeManualEnrollment({ action: "student_report" });
  return { data: Array.isArray(response?.data) ? response.data : null, error };
}

export async function resolveSuperAdminStudentLabels(studentIds = []) {
  const uniqueIds = [...new Set(studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const chunks = [];
  for (let index = 0; index < uniqueIds.length; index += 500) {
    chunks.push(uniqueIds.slice(index, index + 500));
  }
  const results = await Promise.all(chunks.map((ids) => invokeManualEnrollment({
    action: "student_labels",
    student_ids: ids,
  })));
  const failed = results.find((result) => result.error);
  if (failed) return { data: null, error: failed.error };
  return { data: results.flatMap((result) => Array.isArray(result.response?.data) ? result.response.data : []), error: null };
}
