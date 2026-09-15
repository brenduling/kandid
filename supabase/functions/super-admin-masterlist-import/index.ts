import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REQUIRED_STUDENT_ORGANIZATION_NAMES = [
  "WITSG",
  "WIT-SG",
  "WIT SG",
  "Western Institute of Technology Student Government",
];

const VALID_RECONCILIATION_STATUSES = [
  "new",
  "continuing",
  "returnee",
  "shifted_program",
  "conflict",
  "invalid",
  "pending",
];

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeProgram(value: unknown) {
  return cleanText(value, 80).toUpperCase();
}

function parsePositiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} is required.`);
  }
  return number;
}

function parseYearLevel(value: unknown) {
  const yearLevel = Number(value);
  if (!Number.isInteger(yearLevel) || yearLevel <= 0 || yearLevel > 12) {
    throw new Error("Enter a valid year level.");
  }
  return yearLevel;
}

function normalizeEditableRow(input: unknown) {
  const row = (input || {}) as Record<string, unknown>;
  const studentNumber = cleanText(row.student_number, 80);
  const firstName = cleanText(row.first_name);
  const lastName = cleanText(row.last_name);
  const email = cleanText(row.email, 320).toLowerCase();
  const program = normalizeProgram(row.program);
  const yearLevel = parseYearLevel(row.year_level);

  if (!studentNumber) throw new Error("student_number is required.");
  if (!firstName) throw new Error("first_name is required.");
  if (!lastName) throw new Error("last_name is required.");
  if (email && !email.includes("@")) throw new Error("valid email is required.");
  if (!program) throw new Error("program is required.");

  return {
    student_number: studentNumber,
    first_name: firstName,
    last_name: lastName,
    email,
    program,
    year_level: yearLevel,
    is_shs: false,
    matched_student_id: null,
    reconciliation_status: "pending",
    issue_message: null,
    review_status: "none",
    reviewed_by: null,
    reviewed_at: null,
    review_decision: null,
    review_note: null,
    review_fingerprint: null,
  };
}

function sanitizeDbError(error: { code?: string; message?: string } | null) {
  if (!error) return "Masterlist request failed.";
  const message = String(error.message || "").toLowerCase();

  if (error.code === "23503") return "The selected academic term is not valid.";
  if (error.code === "23505") return "The masterlist contains duplicate data that could not be saved.";
  if (message.includes("shifted program") && message.includes("approval")) {
    return "Program changes must be approved before finalizing.";
  }
  if (message.includes("pending reconciliation")) {
    return "Some rows are still pending reconciliation.";
  }
  if (message.includes("invalid row")) {
    return "Invalid rows must be resolved before finalizing.";
  }
  if (message.includes("conflict row")) {
    return "Conflict rows must be resolved before finalizing.";
  }

  return "Masterlist request could not be completed.";
}

async function requireSuperAdmin(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return { response: jsonResponse({ error: "Authentication required." }, 401) };

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id) {
    return { response: jsonResponse({ error: "Invalid or expired session." }, 401) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: adminProfile, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (adminError) {
    return { response: jsonResponse({ error: "Unable to verify Super Admin access." }, 500) };
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    adminProfile.role !== "super_admin" ||
    adminProfile.status !== "active"
  ) {
    return { response: jsonResponse({ error: "Active Super Admin authorization required." }, 403) };
  }

  return { adminClient, user, adminProfile };
}

async function resolvePreviousTermId(adminClient: ReturnType<typeof createClient>, academicTermId: number) {
  const { data: targetTerm, error: targetError } = await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester")
    .eq("id", academicTermId)
    .maybeSingle();

  if (targetError || !targetTerm) return null;

  const targetYearStart = Number(String(targetTerm.academic_year || "").split("-")[0]);
  const targetSemesterOrder = targetTerm.semester === "1st Semester" ? 1 : 2;
  if (!Number.isInteger(targetYearStart) || !targetSemesterOrder) return null;

  const { data: terms } = await adminClient
    .from("academic_terms")
    .select("id, academic_year, semester, status")
    .in("status", ["active", "closed"]);

  return (terms || [])
    .map((term) => ({
      ...term,
      yearStart: Number(String(term.academic_year || "").split("-")[0]),
      semesterOrder: term.semester === "1st Semester" ? 1 : 2,
    }))
    .filter((term) =>
      Number.isInteger(term.yearStart) &&
      term.semesterOrder &&
      (term.yearStart < targetYearStart ||
        (term.yearStart === targetYearStart && term.semesterOrder < targetSemesterOrder))
    )
    .sort((a, b) => b.yearStart - a.yearStart || b.semesterOrder - a.semesterOrder)[0]?.id || null;
}

async function loadImport(adminClient: ReturnType<typeof createClient>, importId: number) {
  const { data: masterlistImport, error: importError } = await adminClient
    .from("masterlist_imports")
    .select("id, academic_term_id, file_name, import_status, total_rows, valid_rows, invalid_rows, conflict_rows, created_at, finalized_at, academic_terms(id, academic_year, semester, status)")
    .eq("id", importId)
    .maybeSingle();

  if (importError) return { data: null, error: importError };
  if (!masterlistImport) return { data: null, error: new Error("Masterlist import was not found.") };

  const { data: rows, error: rowsError } = await adminClient
    .from("masterlist_import_rows")
    .select("id, import_id, row_number, student_number, first_name, last_name, email, program, year_level, is_shs, matched_student_id, reconciliation_status, issue_message, review_status, reviewed_by, reviewed_at, review_decision, review_note, review_fingerprint, created_at")
    .eq("import_id", importId)
    .order("row_number", { ascending: true });

  if (rowsError) return { data: null, error: rowsError };

  const matchedStudentIds = [
    ...new Set((rows || []).map((row) => Number(row.matched_student_id)).filter(Boolean)),
  ];

  const previousTermId = await resolvePreviousTermId(
    adminClient,
    Number(masterlistImport.academic_term_id),
  );

  const [studentsResult, previousEnrollmentsResult] = await Promise.all([
    matchedStudentIds.length > 0
      ? adminClient
        .from("students")
        .select("id, student_number, first_name, last_name, email, program, year_level")
        .in("id", matchedStudentIds)
      : Promise.resolve({ data: [], error: null }),
    matchedStudentIds.length > 0 && previousTermId
      ? adminClient
        .from("student_term_enrollments")
        .select("student_id, program, year_level, enrollment_status")
        .eq("academic_term_id", previousTermId)
        .in("student_id", matchedStudentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (studentsResult.error) return { data: null, error: studentsResult.error };
  if (previousEnrollmentsResult.error) return { data: null, error: previousEnrollmentsResult.error };

  const studentsById = new Map(
    (studentsResult.data || []).map((student) => [Number(student.id), student]),
  );
  const previousEnrollmentByStudentId = new Map(
    (previousEnrollmentsResult.data || []).map((enrollment) => [
      Number(enrollment.student_id),
      enrollment,
    ]),
  );

  const enrichedRows = (rows || []).map((row) => {
    const matchedStudentId = Number(row.matched_student_id);
    const matchedStudent = studentsById.get(matchedStudentId) || null;
    const previousEnrollment = previousEnrollmentByStudentId.get(matchedStudentId) || null;

    return {
      ...row,
      incoming_program: row.program || null,
      previous_program: previousEnrollment?.program || null,
      matched_student: matchedStudent,
    };
  });

  const counts = VALID_RECONCILIATION_STATUSES.reduce<Record<string, number>>((current, status) => {
    current[status] = enrichedRows.filter((row) => row.reconciliation_status === status).length;
    return current;
  }, {});

  counts.approved_program_changes = enrichedRows.filter(
    (row) => row.reconciliation_status === "shifted_program" && row.review_status === "approved",
  ).length;
  counts.pending_program_changes = enrichedRows.filter(
    (row) => row.reconciliation_status === "shifted_program" && row.review_status === "pending_review",
  ).length;
  counts.rejected_program_changes = enrichedRows.filter(
    (row) => row.reconciliation_status === "shifted_program" && row.review_status === "rejected",
  ).length;
  counts.blocking = enrichedRows.filter(
    (row) =>
      row.reconciliation_status === "invalid" ||
      row.reconciliation_status === "conflict" ||
      (row.reconciliation_status === "shifted_program" && row.review_status !== "approved"),
  ).length;

  return {
    data: {
      import: masterlistImport,
      rows: enrichedRows,
      counts,
    },
    error: null,
  };
}

async function ensureEditableImportRow(
  adminClient: ReturnType<typeof createClient>,
  importId: number,
  rowId: number,
) {
  const { data: masterlistImport, error: importError } = await adminClient
    .from("masterlist_imports")
    .select("id, import_status, finalized_at")
    .eq("id", importId)
    .maybeSingle();

  if (importError) return { error: importError };
  if (!masterlistImport?.id) return { response: jsonResponse({ error: "Masterlist import was not found." }, 404) };
  if (masterlistImport.import_status === "finalized" || masterlistImport.finalized_at) {
    return { response: jsonResponse({ error: "Finalized masterlists cannot be edited." }, 409) };
  }

  const { data: row, error: rowError } = await adminClient
    .from("masterlist_import_rows")
    .select("id, import_id")
    .eq("id", rowId)
    .eq("import_id", importId)
    .maybeSingle();

  if (rowError) return { error: rowError };
  if (!row?.id) return { response: jsonResponse({ error: "Masterlist row was not found." }, 404) };

  return { row };
}

async function rerunReconciliationAndLoad(
  adminClient: ReturnType<typeof createClient>,
  importId: number,
) {
  const { error: reconcileError } = await adminClient.rpc("reconcile_masterlist_import", {
    target_import_id: importId,
  });

  if (reconcileError) return { data: null, error: reconcileError };
  return loadImport(adminClient, importId);
}

async function ensureProgram(adminClient: ReturnType<typeof createClient>, program: string) {
  if (!program) return null;

  const { data, error } = await adminClient
    .from("programs")
    .upsert({ code: program, name: program }, { onConflict: "code" })
    .select("id")
    .single();

  if (error) return null;
  return data?.id || null;
}

async function resolveMembershipOrganizationIds(adminClient: ReturnType<typeof createClient>, program: string) {
  const { data: requiredOrganizations } = await adminClient
    .from("organizations")
    .select("id")
    .in("name", REQUIRED_STUDENT_ORGANIZATION_NAMES);

  const programId = await ensureProgram(adminClient, program);
  const { data: programOrganizations } = programId
    ? await adminClient
      .from("organization_programs")
      .select("organization_id")
      .eq("program_id", programId)
    : { data: [] };

  return [
    ...new Set(
      [
        ...(requiredOrganizations || []).map((organization) => organization.id),
        ...(programOrganizations || []).map((link) => link.organization_id),
      ]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];
}

async function ensureTermParticipations(
  adminClient: ReturnType<typeof createClient>,
  rows: Array<{ student_id: number; organization_id: number }>,
  academicTermId: number,
  source: string,
) {
  let createdTermCount = 0;
  let removedTermCount = 0;

  for (const row of rows) {
    const { data: participationRows, error } = await adminClient.rpc(
      "ensure_student_organization_term_participation",
      {
        target_student_id: Number(row.student_id),
        target_organization_id: Number(row.organization_id),
        target_academic_term_id: academicTermId,
        target_source: source,
      },
    );

    if (error) {
      return { error, createdTermCount, removedTermCount };
    }

    const participation = Array.isArray(participationRows)
      ? participationRows[0]
      : participationRows;

    if (participation?.status === "removed") {
      removedTermCount += 1;
    } else if (participation?.status !== "active") {
      return {
        error: { message: participation?.reason || "Term participation could not be verified." },
        createdTermCount,
        removedTermCount,
      };
    } else if (participation?.created) {
      createdTermCount += 1;
    }
  }

  return { error: null, createdTermCount, removedTermCount };
}

async function syncMembershipsForImport(adminClient: ReturnType<typeof createClient>, importId: number) {
  const { data: masterlistImport, error: importError } = await adminClient
    .from("masterlist_imports")
    .select("academic_term_id")
    .eq("id", importId)
    .single();

  if (importError || !masterlistImport?.academic_term_id) {
    return {
      error: importError || { message: "Masterlist import academic term could not be loaded." },
      syncedCount: 0,
      syncedTermCount: 0,
      removedTermCount: 0,
    };
  }

  const { data: rows, error: rowsError } = await adminClient
    .from("masterlist_import_rows")
    .select("matched_student_id, program, reconciliation_status")
    .eq("import_id", importId)
    .in("reconciliation_status", ["new", "continuing", "shifted_program", "returnee"]);

  if (rowsError) {
    return { error: rowsError, syncedCount: 0, syncedTermCount: 0, removedTermCount: 0 };
  }

  const membershipRows: Array<{ student_id: number; organization_id: number; role: string }> = [];

  for (const row of rows || []) {
    const studentId = Number(row.matched_student_id);
    const program = normalizeProgram(row.program);
    if (!studentId) continue;

    const organizationIds = await resolveMembershipOrganizationIds(adminClient, program);
    organizationIds.forEach((organizationId) => {
      membershipRows.push({
        student_id: studentId,
        organization_id: organizationId,
        role: "member",
      });
    });
  }

  const dedupedRows = Array.from(
    new Map(
      membershipRows.map((row) => [`${row.student_id}:${row.organization_id}`, row]),
    ).values(),
  );

  if (dedupedRows.length === 0) {
    return { error: null, syncedCount: 0, syncedTermCount: 0, removedTermCount: 0 };
  }

  const { error } = await adminClient
    .from("student_organizations")
    .upsert(dedupedRows, {
      onConflict: "student_id,organization_id",
      ignoreDuplicates: true,
    });

  if (error) return { error, syncedCount: 0, syncedTermCount: 0, removedTermCount: 0 };

  const termParticipationResult = await ensureTermParticipations(
    adminClient,
    dedupedRows,
    Number(masterlistImport.academic_term_id),
    "masterlist",
  );

  if (termParticipationResult.error) {
    return {
      error: termParticipationResult.error,
      syncedCount: dedupedRows.length,
      syncedTermCount: termParticipationResult.createdTermCount,
      removedTermCount: termParticipationResult.removedTermCount,
    };
  }

  return {
    error: null,
    syncedCount: dedupedRows.length,
    syncedTermCount: termParticipationResult.createdTermCount,
    removedTermCount: termParticipationResult.removedTermCount,
  };
}

function normalizeRows(inputRows: unknown) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    throw new Error("At least one valid CSV row is required.");
  }

  return inputRows.map((input, index) => {
    const row = (input || {}) as Record<string, unknown>;
    const studentNumber = cleanText(row.student_number, 80);
    const firstName = cleanText(row.first_name);
    const lastName = cleanText(row.last_name);
    const email = cleanText(row.email, 320).toLowerCase();
    const program = normalizeProgram(row.program);
    const yearLevel = parseYearLevel(row.year_level);

    if (!studentNumber) throw new Error(`Row ${index + 1}: student_number is required.`);
    if (!firstName) throw new Error(`Row ${index + 1}: first_name is required.`);
    if (!lastName) throw new Error(`Row ${index + 1}: last_name is required.`);
    if (email && !email.includes("@")) throw new Error(`Row ${index + 1}: valid email is required.`);
    if (!program) throw new Error(`Row ${index + 1}: program is required.`);

    return {
      row_number: Number(row.row_number) || index + 2,
      student_number: studentNumber,
      first_name: firstName,
      last_name: lastName,
      email,
      program,
      year_level: yearLevel,
      is_shs: false,
    };
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const auth = await requireSuperAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { adminClient } = auth;
  const action = String(body.action || "");

  try {
    if (action === "create_import") {
      const academicTermId = parsePositiveInteger(body.academic_term_id, "Academic term");
      const fileName = cleanText(body.file_name, 500) || "masterlist.csv";
      const rows = normalizeRows(body.rows);

      const { data: term, error: termError } = await adminClient
        .from("academic_terms")
        .select("id, status")
        .eq("id", academicTermId)
        .maybeSingle();

      if (termError) return jsonResponse({ error: "Unable to verify academic term." }, 500);
      if (!term?.id) return jsonResponse({ error: "Academic term was not found." }, 404);
      if (term.status === "closed") {
        return jsonResponse({ error: "Closed academic terms cannot receive masterlist imports." }, 409);
      }

      const { data: masterlistImport, error: importError } = await adminClient
        .from("masterlist_imports")
        .insert([{ academic_term_id: academicTermId, file_name: fileName, import_status: "draft" }])
        .select("id")
        .single();

      if (importError || !masterlistImport?.id) {
        return jsonResponse({ error: sanitizeDbError(importError) }, 400);
      }

      const stagedRows = rows.map((row) => ({
        ...row,
        import_id: masterlistImport.id,
      }));

      const { error: rowsError } = await adminClient
        .from("masterlist_import_rows")
        .insert(stagedRows);

      if (rowsError) return jsonResponse({ error: sanitizeDbError(rowsError) }, 400);

      const { error: reconcileError } = await adminClient.rpc("reconcile_masterlist_import", {
        target_import_id: masterlistImport.id,
      });

      if (reconcileError) return jsonResponse({ error: sanitizeDbError(reconcileError) }, 400);

      const loaded = await loadImport(adminClient, Number(masterlistImport.id));
      if (loaded.error) return jsonResponse({ error: sanitizeDbError(loaded.error) }, 400);
      return jsonResponse({
        data: {
          ...loaded.data,
          success: true,
          import_id: Number(masterlistImport.id),
          status: loaded.data?.import?.import_status || "review",
          has_blockers: Number(loaded.data?.counts?.blocking || 0) > 0,
        },
      }, 201);
    }

    if (action === "get_import") {
      const importId = parsePositiveInteger(body.import_id, "Masterlist import");
      const loaded = await loadImport(adminClient, importId);
      if (loaded.error) return jsonResponse({ error: sanitizeDbError(loaded.error) }, 400);
      return jsonResponse({ data: loaded.data });
    }

    if (action === "update_row") {
      const importId = parsePositiveInteger(body.import_id, "Masterlist import");
      const rowId = parsePositiveInteger(body.row_id, "Masterlist row");
      const updates = normalizeEditableRow(body.row);
      const editable = await ensureEditableImportRow(adminClient, importId, rowId);

      if ("response" in editable) return editable.response;
      if (editable.error) return jsonResponse({ error: sanitizeDbError(editable.error) }, 400);

      const { error: updateError } = await adminClient
        .from("masterlist_import_rows")
        .update(updates)
        .eq("id", rowId)
        .eq("import_id", importId);

      if (updateError) return jsonResponse({ error: sanitizeDbError(updateError) }, 400);

      const loaded = await rerunReconciliationAndLoad(adminClient, importId);
      if (loaded.error) return jsonResponse({ error: sanitizeDbError(loaded.error) }, 400);
      return jsonResponse({ data: loaded.data });
    }

    if (action === "remove_row") {
      const importId = parsePositiveInteger(body.import_id, "Masterlist import");
      const rowId = parsePositiveInteger(body.row_id, "Masterlist row");
      const editable = await ensureEditableImportRow(adminClient, importId, rowId);

      if ("response" in editable) return editable.response;
      if (editable.error) return jsonResponse({ error: sanitizeDbError(editable.error) }, 400);

      const { error: deleteError } = await adminClient
        .from("masterlist_import_rows")
        .delete()
        .eq("id", rowId)
        .eq("import_id", importId);

      if (deleteError) return jsonResponse({ error: sanitizeDbError(deleteError) }, 400);

      const loaded = await rerunReconciliationAndLoad(adminClient, importId);
      if (loaded.error) return jsonResponse({ error: sanitizeDbError(loaded.error) }, 400);
      return jsonResponse({ data: loaded.data });
    }

    if (action === "finalize_import") {
      const importId = parsePositiveInteger(body.import_id, "Masterlist import");

      const { error: finalizeError } = await adminClient.rpc("finalize_masterlist_import", {
        target_import_id: importId,
      });

      if (finalizeError) return jsonResponse({ error: sanitizeDbError(finalizeError) }, 400);

      const membershipResult = await syncMembershipsForImport(adminClient, importId);
      if (membershipResult.error) {
        return jsonResponse(
          {
            error: "Masterlist finalized, but organization membership synchronization failed.",
            membership_error: sanitizeDbError(membershipResult.error),
          },
          500,
        );
      }

      const loaded = await loadImport(adminClient, importId);
      if (loaded.error) return jsonResponse({ error: sanitizeDbError(loaded.error) }, 400);
      return jsonResponse({
        data: {
          ...loaded.data,
          membership_synced_count: membershipResult.syncedCount,
          term_participation_synced_count: membershipResult.syncedTermCount,
          removed_term_participation_count: membershipResult.removedTermCount,
        },
      });
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Masterlist request failed." },
      400,
    );
  }

  return jsonResponse({ error: "Unsupported masterlist action." }, 400);
});
