import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = readFileSync(new URL("../src/pages/shared/Profile.jsx", import.meta.url), "utf8");
const passwordHandler = profile.match(
  /async function handlePasswordChange\(event\) \{([\s\S]*?)\n  \}\n\n  async function handleInstallApp/,
)?.[1];

test("Board password change uses the signed-in Supabase Auth identity with current-password verification", () => {
  assert.ok(passwordHandler, "the Board Profile password handler must exist");
  assert.match(passwordHandler, /if \(!secureAdminProfile\)/);
  assert.match(passwordHandler, /current_password:\s*currentPassword/);
  assert.match(passwordHandler, /password:\s*newPassword/);
  assert.match(passwordHandler, /supabase\.auth\.updateUser\(/);
  assert.doesNotMatch(passwordHandler, /\.from\(|localStorage|sessionStorage|console\./);
});

test("password submission requires a valid policy, matching confirmation, and prevents duplicate requests", () => {
  assert.match(passwordHandler, /passwordSubmitRef\.current/);
  assert.match(passwordHandler, /isPasswordValid\(newPassword\)/);
  assert.match(passwordHandler, /newPassword !== confirmNewPassword/);
  assert.match(profile, /disabled=\{passwordSubmitting \|\| !currentPassword \|\| !isPasswordValid\(newPassword\) \|\| newPassword !== confirmNewPassword\}/);
});

test("password fields are ephemeral and use the appropriate browser autocomplete modes", () => {
  assert.match(profile, /label="Current password"[\s\S]*?autoComplete="current-password"/);
  assert.match(profile, /label="New password"[\s\S]*?autoComplete="new-password"/);
  assert.match(profile, /label="Confirm new password"[\s\S]*?autoComplete="new-password"/);
  assert.match(profile, /setCurrentPassword\(""\)/);
  assert.match(profile, /setNewPassword\(""\)/);
  assert.match(profile, /setConfirmNewPassword\(""\)/);
});

test("legacy Board accounts are directed to secure sign-in instead of writing passwords to admin_users", () => {
  assert.match(profile, /This account uses legacy sign-in, which cannot safely change a password from Profile/);
  assert.match(profile, /!secureAdminProfile && !isBoard/);
  assert.match(profile, /\{isBoard \? \(/);
});
