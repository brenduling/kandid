import { supabase } from "../lib/supabaseClient";

const MASTERLIST_FUNCTION = "super-admin-masterlist-import";

function unwrapFunctionResult(result) {
  return result?.data || null;
}

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

export async function createMasterlistImport({
  academicTermId,
  fileName,
  rows,
}) {
  const { data: result, error } = await supabase.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "create_import",
        academic_term_id: Number(academicTermId),
        file_name: fileName,
        rows,
      },
    },
  );

  return {
    data: unwrapFunctionResult(result),
    error: await resolveFunctionError(result, error),
  };
}

export async function getMasterlistImport(importId) {
  const { data: result, error } = await supabase.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "get_import",
        import_id: Number(importId),
      },
    },
  );

  return {
    data: unwrapFunctionResult(result),
    error: await resolveFunctionError(result, error),
  };
}

export async function updateMasterlistImportRow({
  importId,
  rowId,
  row,
}) {
  const { data: result, error } = await supabase.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "update_row",
        import_id: Number(importId),
        row_id: Number(rowId),
        row,
      },
    },
  );

  return {
    data: unwrapFunctionResult(result),
    error: await resolveFunctionError(result, error),
  };
}

export async function removeMasterlistImportRow({ importId, rowId }) {
  const { data: result, error } = await supabase.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "remove_row",
        import_id: Number(importId),
        row_id: Number(rowId),
      },
    },
  );

  return {
    data: unwrapFunctionResult(result),
    error: await resolveFunctionError(result, error),
  };
}

export async function finalizeMasterlistImport(importId) {
  const { data: result, error } = await supabase.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "finalize_import",
        import_id: Number(importId),
      },
    },
  );

  return {
    data: unwrapFunctionResult(result),
    error: await resolveFunctionError(result, error),
  };
}

export async function reviewMasterlistImportRow({
  rowId,
  expectedReviewFingerprint,
  decision,
  note,
}) {
  const { data, error } = await supabase.rpc("review_masterlist_import_row", {
    target_row_id: Number(rowId),
    expected_review_fingerprint: expectedReviewFingerprint,
    decision,
    note: note || null,
  });

  return { data, error };
}
