import { supabase } from "../lib/supabaseClient";

const SUPER_ADMIN_MANUAL_ENROLLMENT_FUNCTION = "super-admin-manual-enrollment";

export async function manuallyEnrollSuperAdminStudent(student) {
  const { data: result, error } = await supabase.functions.invoke(
    SUPER_ADMIN_MANUAL_ENROLLMENT_FUNCTION,
    {
      body: { student },
    },
  );

  let resolvedError = error || (result?.error ? new Error(result.error) : null);
  if (error?.context?.json) {
    try {
      const payload = await error.context.clone().json();
      resolvedError = new Error(payload?.error || error.message);
    } catch {
      resolvedError = error;
    }
  }

  return {
    data: result?.data || null,
    academicTerm: result?.academic_term || null,
    createdStudent: Boolean(result?.created_student),
    createdOrganizationIds: result?.created_organization_ids || [],
    existingOrganizationIds: result?.existing_organization_ids || [],
    error: resolvedError,
  };
}
