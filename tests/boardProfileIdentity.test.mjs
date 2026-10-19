import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = readFileSync(new URL("../src/pages/shared/Profile.jsx", import.meta.url), "utf8");
const profileHelper = readFileSync(new URL("../src/utils/profile.js", import.meta.url), "utf8");
const adminUsers = readFileSync(new URL("../src/utils/adminUsers.js", import.meta.url), "utf8");
const adminFunction = readFileSync(
  new URL("../supabase/functions/admin-user-management/index.ts", import.meta.url),
  "utf8",
);
const usersRoles = readFileSync(new URL("../src/pages/superadmin/UsersRoles.jsx", import.meta.url), "utf8");

test("Board Profile displays the authoritative name read-only and omits it from self-service payloads", () => {
  assert.match(profile, /isBoard \? \([\s\S]*?<label>Full name<\/label>[\s\S]*?readOnly[\s\S]*?Managed by the system administrator\./);
  assert.match(profile, /user\?\.role === "electoral_board"\s*\?\s*\{\s*email: form\.email \|\| null,\s*photo_url: form\.photo_url \|\| null,/);
  assert.match(profileHelper, /user\.role !== "electoral_board" && payload\.full_name !== undefined/);
  assert.match(profileHelper, /user\.role !== "electoral_board" && payload\.full_name !== undefined[\s\S]*?photo_url: payload\.photo_url/);
});

test("Board self-profile Edge Function action is photo-only and cannot be used for other admin operations", () => {
  assert.match(adminFunction, /adminProfile\.role !== "super_admin"[\s\S]*?action === "update_self_profile"/);
  assert.match(adminFunction, /adminProfile\.role === "electoral_board" \? "" : cleanText\(profile\.full_name\)/);
  assert.match(adminFunction, /adminProfile\.role === "electoral_board" \? \{\} : \{ full_name: fullName \}/);
  assert.match(adminFunction, /\.eq\("id", adminProfile\.id\)[\s\S]*?\.eq\("auth_user_id", auth\.user\.id\)[\s\S]*?\.eq\("role", adminProfile\.role\)[\s\S]*?\.eq\("status", "active"\)/);
});

test("Super Admin Users & Roles remains the administrative Board-name editor", () => {
  assert.match(usersRoles, /full_name: form\.full_name\.trim\(\)/);
  assert.match(usersRoles, /updateAdminUser\(editing\.id, payload\)/);
  assert.match(adminUsers, /export async function updateAdminUser/);
  assert.match(adminUsers, /return invokeAdminUserManagement\("update", \{ id, admin: payload \}\)/);
});
