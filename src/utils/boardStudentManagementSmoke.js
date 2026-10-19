const OFFICIAL_URL = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const FUNCTION_NAME = "board-manual-enrollment";
const WRITE_PROBES = Object.freeze([
  ["create_new_student_for_term", "registration_not_enabled"],
  ["enroll_existing_student_for_term", "registration_not_enabled"],
  ["update_student_names", "student_management_not_enabled"],
  ["remove_student_participation", "student_management_not_enabled"],
  ["restore_student_participation", "student_management_not_enabled"],
]);

// Verification only: reads use the application's client; every write probe has
// exactly { action }. No student, changes, verification or removal payload exists.
// Session credentials stay in browser memory and never enter returned results.
export async function runBoardStudentManagementGateOffSmoke({ client, url, publicKey, fetchImpl = globalThis.fetch, registrationEnabled = false }) {
  if (url !== OFFICIAL_URL || client?.supabaseUrl !== OFFICIAL_URL || !publicKey) {
    throw new Error("Smoke test requires the official Kandid client configuration.");
  }
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const session = sessionData?.session;
  if (sessionError || !session?.access_token) throw new Error("Sign in through Kandid with your existing Board account first.");
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user?.id) throw new Error("Your session could not be verified. Sign in again.");

  const results = [];
  const registries = [];
  for (const action of ["list_students", "list_removed_students"]) {
    const { data: payload, error } = await client.functions.invoke(FUNCTION_NAME, {
      body: { action, page: 1, page_size: 1, search: "", sort_by: "newest" },
    });
    const data = payload?.data;
    if (error || !Array.isArray(data?.students) || !data.academic_term?.id) {
      throw new Error(`${action} failed; inspect its Network response without copying credentials or student data.`);
    }
    registries.push(data);
    results.push({ action, http_status: 200, result: "PASS" });
  }

  const target = registries.flatMap((registry) => registry.students).find((student) => student.student_number);
  if (target) {
    const { data: payload, error } = await client.functions.invoke(FUNCTION_NAME, {
      body: { action: "resolve_student_for_term", student_number: target.student_number },
    });
    if (error || !payload?.data?.academic_term?.id || !payload.data.outcome) {
      throw new Error("resolve_student_for_term failed; inspect its sanitized Network outcome.");
    }
    results.push({ action: "resolve_student_for_term", http_status: 200, result: "PASS" });
  } else {
    results.push({ action: "resolve_student_for_term", result: "NOT TESTED: no scoped registry row" });
  }

  for (const [action, expectedCode] of WRITE_PROBES) {
    // Native fetch is used solely for the separately authorized gate-OFF probe.
    // The normal application production-write guard and build flags stay intact.
    const response = await fetchImpl(`${OFFICIAL_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: publicKey, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    const registrationReady = registrationEnabled === true && expectedCode === "registration_not_enabled";
    const passed = registrationReady
      ? response.status === 400 && payload?.data?.outcome === "INVALID_INPUT"
      : response.status === 403 && payload?.code === expectedCode;
    results.push({ action, http_status: response.status,
      result: passed ? registrationReady ? "PASS: registration ON, empty payload rejected" : "PASS: gate OFF" : "FAIL",
      code: passed ? registrationReady ? "invalid_input_no_student_payload" : expectedCode : "unexpected_response" });
    if (!passed) break;
  }
  return results;
}
