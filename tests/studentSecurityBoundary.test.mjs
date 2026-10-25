import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [auth, profile, setup, profilePage, enrollmentUtil, superAdminPage, access, profileEdge,
  loginEdge, adminEdge, expandMigration, contractMigration, masterlistFoundation, linkEdge, rateMigration,
  loginPage, kioskPage, config] = await Promise.all([
  read("src/utils/auth.js"),
  read("src/utils/profile.js"),
  read("src/pages/auth/StudentSetup.jsx"),
  read("src/pages/shared/Profile.jsx"),
  read("src/utils/superAdminManualEnrollment.js"),
  read("src/pages/superadmin/Students.jsx"),
  read("src/utils/organizationAccess.js"),
  read("supabase/functions/student-profile/index.ts"),
  read("supabase/functions/resolve-student-login/index.ts"),
  read("supabase/functions/super-admin-manual-enrollment/index.ts"),
  read("supabase/migrations/20261005110000_students_security_expand.sql"),
  read("supabase/migrations/20261005120000_students_privilege_contract.sql"),
  read("supabase/migrations/20260909090000_masterlist_human_review_foundation.sql"),
  read("supabase/functions/link-student-identity/index.ts"),
  read("supabase/migrations/20261014113000_secure_student_auth_entrypoints.sql"),
  read("src/pages/auth/StudentLogin.jsx"),
  read("src/pages/shared/KioskVoting.jsx"),
  read("supabase/config.toml"),
]);

test("student self profile resolution uses the authenticated trusted read and excludes private columns", () => {
  assert.match(auth, /STUDENT_PROFILE_FUNCTION = "student-profile"/);
  assert.match(auth, /authClient\.functions\.invoke\(STUDENT_PROFILE_FUNCTION/);
  assert.doesNotMatch(auth, /\.from\("students"\)/);
  assert.match(profileEdge, /authClient\.auth\.getUser\(\)/);
  assert.match(profileEdge, /\.eq\("auth_user_id", authUser\.id\)[\s\S]*?\.limit\(2\)/);
  assert.match(profileEdge, /mappings\.length !== 1 \|\| mappings\[0\]\.status !== "active"/);
  assert.match(profileEdge, /const PROFILE_FIELDS = "id, student_number/);
  assert.doesNotMatch(profileEdge.match(/const PROFILE_FIELDS = "([^"]+)"/)?.[1] || "", /password|auth_user_id/);
  assert.match(profileEdge, /student\.photo_url = photoUrl/);
  assert.match(profileEdge, /\.update\(\{ photo_url: photoUrl \}\)/);
  assert.match(profileEdge, /authUser\.email_confirmed_at/);
  assert.match(profileEdge, /\.update\(\{ email: verifiedAuthEmail \}\)/);
});

test("pre-auth Student access returns no identity details and keeps ID-to-email resolution server-side", () => {
  assert.match(auth, /action: "login"/);
  assert.match(auth, /action: "begin_access"/);
  assert.match(auth, /action: "verify_access"/);
  assert.match(auth, /supabase\.auth\.setSession\(/);
  assert.match(loginEdge, /auth\.auth\.signInWithPassword\(/);
  assert.match(loginEdge, /signIn\.data\.user\?\.id === student\?\.auth_user_id/);
  assert.match(loginEdge, /auth\.auth\.verifyOtp\(/);
  assert.doesNotMatch(loginEdge, /login_email|setup_student|recovery_available|legacy_migration_available|auth_linked/);
  assert.match(loginEdge, /MIN_FAILED_LOGIN_MS/);
  assert.match(loginEdge, /unknown-\$\{await keyedFingerprint/);
  assert.match(config, /\[functions\.resolve-student-login\][\s\S]*?verify_jwt = false/);
  assert.match(config, /\[functions\.student-profile\][\s\S]*?verify_jwt = true/);
  assert.match(loginPage, /authenticateStudentByNumber\(/);
  assert.doesNotMatch(loginPage, /signInWithPassword|login_email|recoveryCandidate/);
});

test("setup and recovery disclose only masked pre-auth recognition data and verify only through the trusted email", () => {
  assert.match(auth, /beginStudentAccessVerification/);
  assert.match(auth, /verifyStudentAccessCode/);
  assert.doesNotMatch(setup, /lookupStudentSetupRecord|\.from\("students"\)/);
  assert.doesNotMatch(setup, /details_verified|student\??\.email/);
  assert.match(setup, /partially masked record for you to confirm/);
  assert.match(setup, /student-setup-confirm-record/);
  assert.match(setup, /masked_first_name/);
  assert.doesNotMatch(setup, /maskedStudent\.(full_name|email|auth_user_id)/);
  assert.match(setup, /verifyStudentAccessCode\(/);
  assert.match(setup, /linkCurrentStudentIdentity\([\s\S]*?setupMode: true/);
  assert.match(setup, /STUDENT_OTP_REQUEST_NOTICE/);
  assert.match(linkEdge, /user\.email_confirmed_at/);
  assert.match(linkEdge, /studentEmail !== verifiedEmail/);
  assert.doesNotMatch(linkEdge, /legacy_password|student\.password/);
  const linkLogs = linkEdge.split("\n").filter((line) => /console\.(?:warn|error)/.test(line)).join("\n");
  assert.doesNotMatch(linkLogs, /user\.|student\.|error\.(?:message|code)|body\./);
  for (const source of [loginPage, setup, kioskPage, auth, loginEdge]) {
    assert.doesNotMatch(source, /captcha|turnstile/i);
  }
  assert.match(rateMigration, /kandid_consume_student_auth_rate_limit/);
  assert.match(rateMigration, /\('ip:' \|\| p_requester_fingerprint, 40\)/);
  assert.match(rateMigration, /case when p_operation = 'setup' then 3 else 8 end/);
  assert.match(rateMigration, /interval '15 minutes'/);
  assert.match(rateMigration, /grant execute on function public\.kandid_consume_student_auth_rate_limit[\s\S]*?to service_role/);
  assert.doesNotMatch(rateMigration, /grant execute[^;]*to anon|grant execute[^;]*to authenticated/i);
  assert.match(loginEdge, /cf-connecting-ip/);
  assert.match(loginEdge, /STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET/);
});

test("Student profile self-service keeps passwords in Auth and never directly updates students", () => {
  assert.match(profile, /supabase\.auth\.updateUser\(\{\s*password: payload\.password/);
  assert.match(profile, /supabase\.auth\.updateUser\(\{ email: requestedEmail \}\)/);
  assert.match(profile, /action: "update_photo", photo_url: payload\.photo_url/);
  assert.doesNotMatch(profile, /\.from\("students"\)[\s\S]{0,200}\.update\(/);
  assert.match(profilePage, /Confirm the email change using the verification message/);
});

test("Super Admin student edits and deletion use active-admin trusted RPCs, not browser DML", () => {
  assert.match(adminEdge, /requireSuperAdmin\(request/);
  assert.match(adminEdge, /action === "update_student"/);
  assert.match(adminEdge, /kandid_super_admin_update_student/);
  assert.match(adminEdge, /kandid_super_admin_delete_student/);
  assert.match(adminEdge, /kandid_super_admin_list_students/);
  assert.match(adminEdge, /kandid_super_admin_student_labels/);
  assert.match(adminEdge, /adminProfile\.id/);
  assert.match(enrollmentUtil, /action: "student_deletion_readiness"/);
  assert.match(enrollmentUtil, /action: "delete_student"/);
  assert.doesNotMatch(superAdminPage, /\.from\("students"\)\s*\.update\(/);
  assert.doesNotMatch(superAdminPage, /\.from\("students"\)\s*\.delete\(/);
  assert.match(expandMigration, /for update/);
  assert.match(expandMigration, /pg_catalog\.pg_constraint/);
  assert.match(expandMigration, /delete from public\.student_organizations/);
  assert.match(expandMigration, /insert into public\.audit_logs/);
  assert.match(expandMigration, /p_confirmed/);
});

test("student admin edits cannot write term participation, and deletion preserves unknown FK history", () => {
  const updateFunction = expandMigration.slice(expandMigration.indexOf("create or replace function public.kandid_super_admin_update_student"), expandMigration.indexOf("-- Readiness and deletion"));
  const deletionFunction = expandMigration.slice(expandMigration.indexOf("create or replace function public.kandid_super_admin_delete_student"), expandMigration.indexOf("alter function public.kandid_super_admin_update_student"));
  assert.match(updateFunction, /set student_number[\s\S]*?program = [\s\S]*?year_level =/);
  assert.doesNotMatch(updateFunction, /student_term_enrollments|student_organization_terms|student_organizations/);
  assert.match(deletionFunction, /for fk_row in[\s\S]*?pg_catalog\.pg_constraint/);
  assert.match(deletionFunction, /select r\.oid as relation_oid[\s\S]*?join pg_catalog\.pg_class r on r\.oid = con\.conrelid/i);
  assert.match(deletionFunction, /Student deletion dependency requires manual review/);
  assert.match(deletionFunction, /public\.student_organizations/);
  assert.doesNotMatch(deletionFunction, /student_term_enrollments|student_organization_terms/);
});

test("masterlist finalizer remains a postgres-owned definer boundary with service_role execution only", () => {
  assert.match(expandMigration, /alter function public\.finalize_masterlist_import\(integer\) owner to postgres/);
  assert.match(expandMigration, /alter function public\.finalize_masterlist_import\(integer\) set search_path to pg_catalog/);
  assert.match(expandMigration, /revoke all on function public\.finalize_masterlist_import\(integer\) from public, anon, authenticated, service_role/);
  assert.match(expandMigration, /grant execute on function public\.finalize_masterlist_import\(integer\) to service_role/);
  const start = masterlistFoundation.indexOf("CREATE OR REPLACE FUNCTION public.finalize_masterlist_import(target_import_id integer)");
  const end = masterlistFoundation.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start);
  const finalizerBody = masterlistFoundation.slice(start, end);
  for (const relation of ["masterlist_imports", "academic_terms", "masterlist_import_rows", "students", "student_term_enrollments"]) {
    assert.match(finalizerBody, new RegExp(`(?:from|join|into|update) public\\.${relation}\\b`, "i"));
  }
  assert.doesNotMatch(finalizerBody, /(?:from|join|into|update)\s+(?:masterlist_imports|academic_terms|masterlist_import_rows|students|student_term_enrollments)\b/i);
});

test("final students contract removes browser DML and sensitive SELECT while preserving safe authenticated reads", () => {
  assert.match(contractMigration, /drop policy %I on public\.students/);
  assert.match(contractMigration, /revoke all on table public\.students from public, anon, authenticated/);
  assert.match(contractMigration, /grant select \(id, first_name, last_name, program, year_level, is_shs/);
  assert.match(contractMigration, /revoke all on sequence public\.students_id_seq from public, anon, authenticated/);
  assert.match(contractMigration, /students_safe_authenticated_reads[\s\S]*?a\.role = 'super_admin'/);
  assert.doesNotMatch(contractMigration, /a\.role in \([^)]*electoral_board/);
  assert.match(contractMigration, /students\.auth_user_id = auth\.uid\(\)/);
  assert.match(contractMigration, /has_column_privilege\(role_name, 'public\.students', 'password', 'SELECT'\)/);
  assert.match(contractMigration, /has_column_privilege\(role_name, 'public\.students', a\.attname, 'UPDATE'\)/);
  assert.match(expandMigration, /row_offset bigint[\s\S]*?row_offset := \(page_number::bigint - 1\) \* page_limit/);
  assert.match(expandMigration, /notify pgrst, 'reload schema'/i);
  assert.match(contractMigration, /notify pgrst, 'reload schema'/i);
  assert.match(contractMigration, /has_column_privilege\(role_name, 'public\.students', 'auth_user_id', 'SELECT'\)/);
  assert.match(contractMigration, /has_column_privilege\(role_name, 'public\.students', 'student_number', 'SELECT'\)/);
  assert.match(contractMigration, /has_column_privilege\(role_name, 'public\.students', 'email', 'SELECT'\)/);
  assert.match(contractMigration, /has_table_privilege\('service_role', 'public\.students', 'UPDATE'\)/);
  assert.doesNotMatch(contractMigration, /grant\s+(?:all|insert|delete).*students\s+to\s+(?:anon|authenticated)/i);
});

test("dormant browser helper cannot create central student records", () => {
  assert.doesNotMatch(access, /findOrCreateStudentByNumber|findStudentByNumber|selectStructuralOrganizationMembershipsForCompatibility/);
  assert.doesNotMatch(access, /\.from\("students"\)[\s\S]{0,250}\.insert\(/);
});
