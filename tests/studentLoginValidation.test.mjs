import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getStudentLoginValidationErrors } from "../src/utils/studentLoginValidation.js";

const login = await readFile(new URL("../src/pages/auth/StudentLogin.jsx", import.meta.url), "utf8");
const validationLayer = await readFile(new URL("../src/components/ProgressiveValidationLayer.jsx", import.meta.url), "utf8");
const authLayout = await readFile(new URL("../src/components/AuthLayout.jsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const kiosk = await readFile(new URL("../src/pages/shared/KioskVoting.jsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

test("Student sign-in returns one explicit message per missing field", () => {
  assert.deepEqual(getStudentLoginValidationErrors("", ""), {
    studentNumber: "Enter your Student ID Number.",
    password: "Enter your password.",
  });
  assert.deepEqual(getStudentLoginValidationErrors("  ", "secret"), {
    studentNumber: "Enter your Student ID Number.",
  });
  assert.deepEqual(getStudentLoginValidationErrors("12345", ""), {
    password: "Enter your password.",
  });
  assert.deepEqual(getStudentLoginValidationErrors("12345", "secret"), {});
});

test("Student sign-in fields render their local error once and opt out of the shared layer", () => {
  assert.match(login, /<form onSubmit=\{handleLogin\} noValidate>/);
  assert.equal((login.match(/data-validation-ignore="true"/g) || []).length, 2);
  assert.equal((login.match(/id="student-login-number-error"/g) || []).length, 1);
  assert.equal((login.match(/id="student-login-password-error"/g) || []).length, 1);
  assert.match(validationLayer, /element\.dataset\?\.validationIgnore === "true"/);
});

test("Student and kiosk sign-in submit credentials without a CAPTCHA prerequisite", () => {
  for (const source of [login, kiosk, auth]) assert.doesNotMatch(source, /captcha|turnstile/i);
  assert.match(login, /disabled=\{loading\}/);
  assert.match(kiosk, /disabled=\{verifying\}/);
  assert.match(auth, /action: "login",\s*student_number: studentNumber,\s*password,/);
});

test("Student sign-in uses the identity column title and keeps account setup and recovery route", () => {
  assert.match(login, /identityTitle="Let's get you in\."/);
  assert.match(authLayout, /<h1>\{identityTitle\}<\/h1>/);
  assert.match(login, /First time here\?/);
  assert.match(login, /Complete account setup/);
  assert.match(login, /Account setup and password recovery use your registered email/);
  assert.match(login, /navigate\("\/student-setup"/);
  assert.match(app, /path="\/student-setup"/);
});

test("Student sign-in keeps the responsive two-column editorial layout and underline controls", () => {
  assert.match(styles, /\.kandid-auth-screen\.kandid-auth-screen--student\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.95fr\) minmax\(0, 1\.05fr\)/s);
  assert.match(styles, /\.kandid-auth-screen\.kandid-auth-screen--student \.student-auth-card input\s*\{[^}]*border:\s*0 !important;[^}]*border-bottom:\s*1px solid/s);
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*?\.kandid-auth-screen\.kandid-auth-screen--student \.kandid-auth-identity\s*\{[^}]*border-bottom/s);
  assert.match(styles, /\.kandid-auth-screen\.kandid-auth-screen--student \.student-login-new-account\s*\{[^}]*border-top:\s*1px solid/s);
});

test("kiosk retains its isolated Auth client, trusted profile and election authorization", () => {
  assert.match(auth, /const kioskClient = createIsolatedStudentAuthClient\(\)/);
  assert.match(auth, /persistSession: false/);
  assert.match(auth, /resolveStudentProfileForClient\(kioskClient\)/);
  assert.match(auth, /String\(profileResult\.data\.student_number\) !== normalizedStudentNumber/);
  assert.match(auth, /await kioskClient\.auth\.signOut\(\)/);
  assert.match(kiosk, /await revalidateSelectedElection\(\)/);
  assert.match(kiosk, /eligibleOrganizationIds\.includes\(Number\(currentElection\.election\.organization_id\)\)/);
  assert.match(kiosk, /hasStudentVotedInElection\(studentData\.id, currentElection\.election\.id, kioskAuth\.client\)/);
});
