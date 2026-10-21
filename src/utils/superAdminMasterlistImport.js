import { supabase } from "../lib/supabaseClient";
import { invokeStudentManagement } from "./studentManagementRequest.js";

const MASTERLIST_FUNCTION = "super-admin-masterlist-import";

function unwrapFunctionResult(result) {
  return result?.data || null;
}

const masterlistClient = {functions:{invoke:async(endpoint,options)=>{
  const {response,error}=await invokeStudentManagement(supabase,endpoint,options.body);
  return {data:response,error};
}}};
const resolveFunctionError = async (result,error) => error || (result?.error ? new Error(result.error) : null);

export async function createMasterlistImport({
  academicTermId,
  fileName,
  rows,
  importScope = "incremental",
}) {
  const { data: result, error } = await masterlistClient.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "create_import",
        academic_term_id: Number(academicTermId),
        file_name: fileName,
        import_scope: importScope,
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
  const { data: result, error } = await masterlistClient.functions.invoke(
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
  const { data: result, error } = await masterlistClient.functions.invoke(
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
  const { data: result, error } = await masterlistClient.functions.invoke(
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

export async function finalizeMasterlistImport(importId, options = {}) {
  const { data: result, error } = await masterlistClient.functions.invoke(
    MASTERLIST_FUNCTION,
    {
      body: {
        action: "finalize_import",
        import_id: Number(importId),
        confirm_full_roster: options.confirmFullRoster === true,
        absence_preview_fingerprint: options.absencePreviewFingerprint || null,
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
