import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminLogin = await readFile(new URL("../src/pages/auth/AdminLogin.jsx", import.meta.url), "utf8");
const boardLogin = await readFile(new URL("../src/pages/auth/BoardLogin.jsx", import.meta.url), "utf8");
const setup = await readFile(new URL("../src/pages/auth/AdminAuthSetup.jsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8");

test("Admin Login uses Supabase Auth and the Super Admin authorization check", () => {
  assert.doesNotMatch(adminLogin, /getAdminAuthMode\(\) === "legacy"/);
  assert.doesNotMatch(adminLogin, /from\("admin_users"\)/);
  assert.doesNotMatch(adminLogin, /select\([^)]*password/);
  assert.match(adminLogin, /supabase\.auth\.signInWithPassword\(/);
  assert.match(adminLogin, /requireAdminRole\("super_admin"\)/);
  assert.match(adminLogin, /linkCurrentAdminIdentity\(\)/);
  assert.match(adminLogin, /signOutAdminSession\(\)/);
  assert.match(adminLogin, /navigate\("\/super-admin\/dashboard", \{ replace: true \}\)/);
  assert.match(app, /path="\/admin-login"\s+element=\{<AdminLogin \/>\}/);
  assert.doesNotMatch(adminLogin, /alert\(/);
});

test("Electoral Board login keeps Auth sign-in and organization-scoped authorization", () => {
  assert.match(boardLogin, /supabase\.auth\.signInWithPassword\(/);
  assert.match(boardLogin, /requireAdminRole\("electoral_board",\s*\{\s*requireOrganization:\s*true/);
  assert.match(boardLogin, /navigate\("\/board\/dashboard", \{ replace: true \}\)/);
  assert.match(auth, /\.eq\("auth_user_id", user\.id\)/);
  assert.match(auth, /if \(requireOrganization && !data\.organization_id\)/);
  assert.doesNotMatch(boardLogin, /password\s*!==|\.from\("admin_users"\)/);
});

test("Admin and Board login forms start without synthetic field errors and use required fields", () => {
  for (const source of [adminLogin, boardLogin]) {
    assert.match(source, /type="email"[\s\S]*?required/);
    assert.match(source, /type=\{showPassword \? "text" : "password"\}[\s\S]*?required/);
    assert.match(source, /\{feedback \? \(/);
    assert.doesNotMatch(source, /is required\./);
  }
});

test("Admin and Board password recovery uses the shared verified Auth setup route", () => {
  assert.match(adminLogin, /<Link to="\/admin-auth\/setup\?mode=recovery">Forgot password\?<\/Link>/);
  assert.match(boardLogin, /<Link to="\/admin-auth\/setup\?mode=recovery">Forgot password\?<\/Link>/);
  assert.match(app, /path="\/admin-auth\/setup"\s+element=\{<AdminAuthSetup \/>\}/);
  assert.match(setup, /supabase\.auth\.resetPasswordForEmail\(/);
  assert.match(setup, /redirectTo/);
  assert.match(setup, /get\("mode"\) === "recovery"/);
  assert.match(setup, /new URL\("\/admin-auth\/setup", window\.location\.origin\)/);
  assert.match(setup, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(setup, /event === "SIGNED_IN" \|\| event === "PASSWORD_RECOVERY"/);
  assert.match(setup, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(setup, /If that address is linked to an account/);
  assert.match(setup, /options\.captchaToken = recoveryCaptchaToken/);
});

test("Admin Login uses the shared progressive validation layer and Board login remains routed", async () => {
  const layer = await readFile(new URL("../src/components/ProgressiveValidationLayer.jsx", import.meta.url), "utf8");
  assert.match(app, /<ProgressiveValidationLayer\s*\/>/);
  assert.match(layer, /document\.addEventListener\("focusout", onBlur, true\)/);
  assert.match(layer, /document\.addEventListener\("submit", onSubmit, true\)/);
  assert.match(layer, /shouldShowProgressiveError\(message, \{ touched: touched\.has\(field\), submitted: revealAll \|\| submitted\.has\(form\) \}\)/);
  assert.match(adminLogin, /id="admin-login-email"[\s\S]*?required/);
  assert.match(adminLogin, /id="admin-login-password"[\s\S]*?required/);
});
