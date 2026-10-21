import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getStudentOtpVerificationError,
  getStudentOtpFailureMessage,
  getStudentOtpRetrySeconds,
  STUDENT_OTP_REQUEST_NOTICE,
  getStudentSetupRequestError,
} from "../src/utils/studentSetupValidation.js";

const setupPage = await readFile(new URL("../src/pages/auth/StudentSetup.jsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8");
const resolver = await readFile(new URL("../supabase/functions/resolve-student-login/index.ts", import.meta.url), "utf8");
const identityLinker = await readFile(new URL("../supabase/functions/link-student-identity/index.ts", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const template = await readFile(new URL("../supabase/templates/student_email_otp.html", import.meta.url), "utf8");

const validSetup = {
  studentNumber: "12345678",
  passwordValid: true,
  passwordsMatch: true,
};

test("setup request reports each missing prerequisite instead of silently blocking", () => {
  assert.match(getStudentSetupRequestError({ ...validSetup, studentNumber: "" }), /valid Student ID/);
  assert.match(getStudentSetupRequestError({ ...validSetup, passwordValid: false }), /password requirement/);
  assert.match(getStudentSetupRequestError({ ...validSetup, passwordsMatch: false }), /passwords do not match/);
  assert.equal(getStudentSetupRequestError(validSetup), "");
});

test("OTP verification validates only the code without asking for an email or CAPTCHA", () => {
  const validOtp = { code: "012345" };
  assert.match(getStudentOtpVerificationError({ ...validOtp, code: "123" }), /six digits/);
  assert.equal(getStudentOtpVerificationError(validOtp), "");
  assert.match(getStudentOtpFailureMessage({ context: { status: 429 } }), /Too many/);
  assert.match(getStudentOtpFailureMessage({ context: { status: 401 } }), /incorrect, expired or already used/);
  assert.match(getStudentOtpFailureMessage({ status: 503 }), /connection/);
});

test("setup confirms recognition and configures password before OTP, committing only after verified admission", () => {
  assert.match(setupPage, /const SETUP_STAGES = \[\s*\{ key: "lookup"[\s\S]*?\{ key: "confirm"[\s\S]*?\{ key: "password"[\s\S]*?\{ key: "otp"/);
  const passwordHandler = setupPage.slice(setupPage.indexOf("async function handlePasswordContinue"), setupPage.indexOf("async function completeSetup"));
  assert.match(passwordHandler, /detailsConfirmed/);assert.match(passwordHandler, /await sendOtp\(\)/);
  assert.match(passwordHandler, /setStep\("otp"\)/);assert.doesNotMatch(passwordHandler, /completeSetup|linkCurrentStudentIdentity|updateUser/);
  const verifyHandler=setupPage.slice(setupPage.indexOf("async function verifyOtp"),setupPage.indexOf("function handleStudentNumberChange"));
  assert.match(verifyHandler,/verifyStudentAccessCode[\s\S]*?setup_verification[\s\S]*?await completeSetup\(proof\)/);
  assert.match(setupPage,/proof\.auth_user_id !== verifiedIdentityRef.current\?\.id/);
  assert.match(setupPage,/disabled=\{!detailsConfirmed\}/);assert.match(setupPage,/OTP_RESEND_COOLDOWN_SECONDS = 60/);
  assert.doesNotMatch(setupPage,/StudentCaptcha|captchaToken|captchaConfigured|Confirm verified password recovery/);
});

test("dispatch notices never claim delivery and cooldown honors bounded server Retry-After", () => {
  assert.doesNotMatch(STUDENT_OTP_REQUEST_NOTICE, /has been sent|delivered successfully/i);
  assert.match(STUDENT_OTP_REQUEST_NOTICE, /If no new email arrives/);
  assert.equal(getStudentOtpRetrySeconds({ context: { status: 429 } }), 900);
  assert.equal(getStudentOtpRetrySeconds({ context: { status: 429, headers: new Headers({ "Retry-After": "1200" }) } }), 1200);
  assert.equal(getStudentOtpRetrySeconds({ context: { headers: new Headers({ "Retry-After": "999999" }) } }), 3600);
  assert.equal(getStudentOtpRetrySeconds(), 60);
});

test("OTP request uses no caller-supplied email and remains bound to the trusted student record", () => {
  assert.doesNotMatch(auth, /const studentAuthClient\s*=/, "setup and sign-in reuse the configured Supabase client");
  assert.match(auth, /beginStudentAccessVerification\(\{ studentNumber \}\)[\s\S]*?supabase\.functions\.invoke/);
  assert.match(auth, /verifyStudentAccessCode[\s\S]*?supabase\.functions\.invoke/);
  assert.match(auth, /beginStudentAccessVerification\(\{ studentNumber \}\)[\s\S]*?action:\s*"begin_access", student_number: studentNumber/);
  assert.match(auth, /verifyStudentAccessCode[\s\S]*?action:\s*"verify_access"[\s\S]*?verification_code/);
  assert.doesNotMatch(auth.match(/export async function verifyStudentAccessCode[\s\S]*?\n}/)?.[0] || "", /registered_email/);
  assert.doesNotMatch(auth.match(/beginStudentAccessVerification[\s\S]*?\n}/)?.[0] || "", /email|captcha/);
  assert.match(resolver, /student\.status === "active" \|\| \(student\.status === "pending" && !student\.auth_user_id\)/);
  assert.match(resolver, /registeredEmail === storedEmail/);
  assert.match(resolver, /auth\.auth\.signInWithOtp/);
  assert.doesNotMatch(resolver, /EdgeRuntime\.waitUntil/);
  assert.match(resolver, /options: \{ shouldCreateUser: false \}/);
  assert.match(resolver, /auth\.admin\.createUser\([\s\S]*?email_confirm: false/);
  assert.match(resolver, /findAuthUserByEmail/);
  assert.match(resolver, /auth\.auth\.verifyOtp/);
  assert.match(resolver, /admin\.createUser\([\s\S]*?email_confirm: false/);
  assert.match(resolver, /hasConflictingIdentityLink/);
  assert.doesNotMatch(resolver, /captcha|turnstile/i);
  assert.doesNotMatch(resolver.slice(resolver.indexOf('if (action === "begin_access")'), resolver.indexOf('if (action === "verify_access")')), /captcha/);
  assert.doesNotMatch(resolver.slice(resolver.indexOf('if (action === "verify_access")'), resolver.indexOf('const targetEmail = eligibleForLogin')), /captcha|validTurnstile/);
  assert.match(config, /\[functions\.resolve-student-login\][\s\S]*?verify_jwt = false/);
  assert.match(config, /otp_length = 6/);
  assert.match(config, /\[auth\.email\.template\.confirmation\][\s\S]*?content_path = "\.\/supabase\/templates\/student_email_otp\.html"/);
  assert.match(config, /\[auth\.email\.template\.magic_link\][\s\S]*?content_path = "\.\/supabase\/templates\/student_email_otp\.html"/);
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /\.ConfirmationURL|\.TokenHash/);
  assert.match(setupPage, /linkCurrentStudentIdentity\([\s\S]*?setupMode: true,[\s\S]*?password/);
  assert.doesNotMatch(setupPage, /supabase\.auth\.updateUser/);
  assert.match(identityLinker, /user\.email_confirmed_at/);
  assert.match(identityLinker, /validSetupPassword\(password\)/);
  assert.match(identityLinker, /fetch\(`\$\{supabaseUrl\}\/auth\/v1\/user`/);
  assert.match(identityLinker, /Authorization: authorization, apikey: anonKey/);
  assert.doesNotMatch(identityLinker, /auth\.admin\.updateUserById|authClient\.auth\.updateUser/);
  assertPasswordBeforeStudentUpdate(identityLinker);
});

function assertPasswordBeforeStudentUpdate(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const passwordIndex = normalized.indexOf("const passwordResponse");
  const updateIndex = normalized.indexOf('.from("students")\n    .update(');
  assert.ok(passwordIndex >= 0 && updateIndex >= 0 && passwordIndex < updateIndex,
    "set password before linking or activating the pending student");
}

test("password-before-linking assertion accepts LF and CRLF without accepting reversed or missing operations", () => {
  const lf = identityLinker.replace(/\r\n/g, "\n");
  for (const source of [lf, lf.replace(/\n/g, "\r\n")]) {
    assertPasswordBeforeStudentUpdate(source);
  }
  assert.throws(() => assertPasswordBeforeStudentUpdate('const passwordResponse = null;'));
  assert.throws(() => assertPasswordBeforeStudentUpdate('.from("students")\n    .update({});\nconst passwordResponse = null;'));
});

test("OTP and final setup network exceptions restore the loading state and surface errors", () => {
  assert.match(setupPage, /catch \{\s*requestResult = \{ error: true \};\s*\} finally \{[\s\S]*?setSendingOtp\(false\)/);
  assert.match(setupPage, /catch \{\s*setSetupError\(getStudentOtpFailureMessage\(\)\);\s*\} finally \{[\s\S]*?setVerifyingOtp\(false\)/);
  assert.match(setupPage, /catch \{[\s\S]*?setSetupError\("We couldn't complete account setup[\s\S]*?finally \{[\s\S]*?setLoading\(false\)/);
});

test("OTP has one local validation owner and completion confirms the linked active Student before showing success", () => {
  const otp = setupPage.slice(setupPage.indexOf("function renderOtpStep"), setupPage.indexOf("async function proceedToLogin"));
  assert.doesNotMatch(otp, /type="email"|registeredEmail|Registered email/);
  assert.match(otp, /data-validation-ignore="true"/);
  assert.equal((otp.match(/role="alert"/g) || []).length, 1);
  assert.match(setupPage, /linkResult\.data\?\.status !== "active"/);
  assert.match(setupPage, /setStep\("success"\)/);
  assert.match(setupPage, /Account Successfully Registered/);
  assert.match(setupPage, /Your Kandid account is now ready\. You can proceed to login\./);
  assert.match(setupPage, /await signOutStudentSetupSession\(\)[\s\S]*?navigate\("\/student-login", \{ replace: true \}\)/);
  const completion = setupPage.slice(setupPage.indexOf("async function completeSetup"), setupPage.indexOf("async function verifyOtp"));
  assert.doesNotMatch(completion, /navigate\(/);
});
