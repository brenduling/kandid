import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LOCAL_PRODUCTION_READONLY_BOARD_PATHS,
  isAllowedLocalProductionDashboardRequest,
  isAllowedLocalProductionReadonlyPath,
  localProductionReadonlyRedirect,
} from "../src/utils/localProductionReadOnly.js";
import { boardMenuGroups } from "../src/config/navigation.js";
import { parse } from "dotenv";

const official = "https://fszgdxqxonqqcrzsnkca.supabase.co";

function allowed(input, method = "GET", body = undefined, role = "super_admin") {
  return isAllowedLocalProductionDashboardRequest({ input, method, body, role });
}

test("read-only dashboard allows login, session checks, dashboard tables, and its read-only RPC", () => {
  assert.equal(allowed(`${official}/auth/v1/token?grant_type=password`, "POST", "{}"), true);
  assert.equal(allowed(`${official}/auth/v1/token?grant_type=refresh_token`, "POST", "{}"), true);
  assert.equal(allowed(`${official}/auth/v1/user`, "GET"), true);
  for (const table of ["organizations", "students", "elections", "admin_users"]) {
    assert.equal(allowed(`${official}/rest/v1/${table}?select=id`, "GET"), true);
    assert.equal(allowed(`${official}/rest/v1/${table}?select=id`, "HEAD"), true);
  }
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_list_super_admin_audit_events`, "POST", "{}"), true);
  assert.equal(allowed(`${official}/functions/v1/vote-access`, "POST", JSON.stringify({ action: "super_admin_vote_count" })), true);
  assert.equal(allowed(`${official}/auth/v1/logout`, "POST", "{}"), true);
});

test("read-only dashboard blocks writes, setup, admin mutations, unsafe RPCs, and other targets", () => {
  assert.equal(allowed(`${official}/rest/v1/students`, "POST", "{}"), false);
  assert.equal(allowed(`${official}/rest/v1/students?id=eq.1`, "PATCH", "{}"), false);
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_delete_student`, "POST", "{}"), false);
  assert.equal(allowed(`${official}/functions/v1/admin-user-management`, "POST", JSON.stringify({ action: "list" })), false);
  assert.equal(allowed(`${official}/functions/v1/vote-access`, "POST", JSON.stringify({ action: "submit_vote" })), false);
  assert.equal(allowed(`${official}/auth/v1/recover`, "POST", "{}"), false);
  assert.equal(allowed("http://127.0.0.1:57321/rest/v1/students", "GET"), false);
  assert.equal(allowed("https://jkkgzhteacaafdnpeomy.supabase.co/rest/v1/students", "GET"), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const resource of ["elections", "positions", "candidates", "students", "votes", "officers"]) {
      assert.equal(allowed(`${official}/rest/v1/${resource}`, method, "{}", "electoral_board"), false, `${method} ${resource}`);
    }
  }
  for (const endpoint of ["submit-vote", "admin-user-management", "officers-contract", "board-manual-enrollment"]) {
    assert.equal(allowed(`${official}/functions/v1/${endpoint}`, "POST", "{}", "electoral_board"), false, endpoint);
  }
});

test("read-only Board mode allows only scoped read requests and the Board dashboard vote summary", () => {
  for (const table of ["organizations", "admin_users", "elections", "positions", "candidates"]) {
    assert.equal(allowed(`${official}/rest/v1/${table}?select=id`, "GET", undefined, "electoral_board"), true);
  }
  assert.equal(allowed(`${official}/rest/v1/students?select=id`, "GET", undefined, "electoral_board"), false);
  assert.equal(allowed(`${official}/rest/v1/admin_users?select=id`, "GET", undefined, null), true);
  assert.equal(allowed(`${official}/rest/v1/elections`, "POST", "{}", "electoral_board"), false);
  assert.equal(allowed(`${official}/rest/v1/positions?id=eq.1`, "PATCH", "{}", "electoral_board"), false);
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_list_board_audit_events`, "POST", "{}", "electoral_board"), true);
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_get_board_voting_monitor`, "POST", "{}", "electoral_board"), true);
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_list_super_admin_audit_events`, "POST", "{}", "electoral_board"), false);
  assert.equal(allowed(`${official}/functions/v1/vote-access`, "POST", JSON.stringify({ action: "board_dashboard_counts", election_ids: [3, 8] }), "electoral_board"), true);
  assert.equal(allowed(`${official}/functions/v1/vote-access`, "POST", JSON.stringify({ action: "board_dashboard_counts", election_ids: [3], extra: true }), "electoral_board"), false);
  assert.equal(allowed(`${official}/functions/v1/vote-access`, "POST", JSON.stringify({ action: "super_admin_vote_count" }), "electoral_board"), false);
  assert.equal(allowed(`${official}/functions/v1/admin-user-management`, "POST", JSON.stringify({ action: "list" }), "electoral_board"), false);
  assert.equal(allowed(`${official}/rest/v1/rpc/kandid_list_super_admin_audit_events`, "POST", "{}", null), false);
});

test("read-only routes preserve Super Admin testing and expose only Board login and read pages", () => {
  for (const path of [
    "/admin-login",
    "/super-admin/dashboard",
    "/board-login",
    "/eb-login",
    "/board-portal",
    "/board/dashboard",
    "/board/positions",
    "/board/candidates",
    "/board/voting-monitor",
    "/board/reports",
    "/board/audit-trail",
  ]) assert.equal(isAllowedLocalProductionReadonlyPath(path), true, path);

  for (const path of ["/student/dashboard", "/board/elections", "/board/results", "/board/students", "/board/profile", "/super-admin/users-roles"]) {
    assert.equal(isAllowedLocalProductionReadonlyPath(path), false, path);
  }
  assert.equal(localProductionReadonlyRedirect("/board/students"), "/eb-login");
  assert.equal(localProductionReadonlyRedirect("/super-admin/users-roles"), "/admin-login");
});

test("the complete 15-item Board menu is retained with unavailable entries disabled in read-only mode", async () => {
  const menuItems = boardMenuGroups.flatMap((group) => group.items);
  assert.equal(menuItems.length, 15);
  assert.deepEqual(menuItems.map((item) => item.path), [
    "/board/dashboard", "/board/students", "/board/csv-import",
    "/board/elections", "/board/positions", "/board/candidates", "/board/officers",
    "/board/partylists", "/board/eligibility-rules", "/board/voting-monitor",
    "/board/kiosk", "/board/results", "/board/reports", "/board/audit-trail",
    "/board/profile",
  ]);
  const layout = await readFile(new URL("../src/layouts/BoardLayout.jsx", import.meta.url), "utf8");
  const mobileMenu = await readFile(new URL("../src/components/MobileMenu.jsx", import.meta.url), "utf8");
  const mobileNav = await readFile(new URL("../src/components/MobileNav.jsx", import.meta.url), "utf8");
  assert.match(layout, /items: group\.items\.map/);
  assert.match(layout, /readonlyUnavailable/);
  assert.match(layout, /disabled\s+aria-disabled="true"/);
  assert.match(mobileMenu, /item\.readonlyUnavailable/);
  assert.match(mobileNav, /item\.readonlyUnavailable/);
  for (const item of menuItems) {
    assert.equal(
      isAllowedLocalProductionReadonlyPath(item.path),
      LOCAL_PRODUCTION_READONLY_BOARD_PATHS.has(item.path),
      item.path,
    );
  }
});

test("read-only mode disables Board write handlers and blocks the direct vote fetch path", async () => {
  const positions = await readFile(new URL("../src/pages/board/Positions.jsx", import.meta.url), "utf8");
  const candidates = await readFile(new URL("../src/components/CandidateManagement.jsx", import.meta.url), "utf8");
  const voting = await readFile(new URL("../src/utils/voting.js", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/layouts/BoardLayout.jsx", import.meta.url), "utf8");
  assert.match(positions, /function openCreate\([^)]*\)\s*\{\s*if \(localProductionReadonly\) return;/);
  assert.match(positions, /async function handleSubmit\(event\)\s*\{\s*event\.preventDefault\(\);\s*if \(localProductionReadonly \|\| positionSaveInFlight\.current\) return;/);
  assert.match(positions, /disabled=\{localProductionReadonly\}/);
  assert.match(candidates, /async function handleSubmit\(event\)\s*\{\s*event\.preventDefault\(\);\s*if \(readonlyBoardInspection \|\| saveInFlight\.current\) return;/);
  assert.match(candidates, /disabled=\{readonlyBoardInspection\}/);
  assert.match(candidates, /if \(!readonlyBoardInspection\)\s*\{\s*let partyRequest = supabase[\s\S]*?\.from\("partylists"\)/);
  assert.match(voting, /import\.meta\.env\.MODE === READ_ONLY_DASHBOARD_MODE \|\| import\.meta\.env\.MODE === "development"/);
  assert.match(voting, /await guardedSupabaseFetch\(/);
  assert.match(layout, /if \(!localProductionReadonly\)\s*\{\s*await logAuditEvent/);
});

test("read-only production environment file resolves only to the official project", async () => {
  const content = await readFile(new URL("../.env.localhost-production-readonly.local", import.meta.url), "utf8");
  const env = parse(content);
  assert.match(env.VITE_SUPABASE_URL, /^https:\/\/fszgdxqxonqqcrzsnkca\.supabase\.co\/?$/);
  assert.ok(env.VITE_SUPABASE_KEY);
  assert.equal(env.KANDID_SUPABASE_KEY_PROJECT_REF, "fszgdxqxonqqcrzsnkca");
  assert.equal(env.KANDID_LOCAL_PRODUCTION_READONLY, "true");
  assert.ok(!env.VITE_SUPABASE_URL.includes("jkkgzhteacaafdnpeomy"));
});

test("the guarded client is active only in the explicit localhost production test mode", async () => {
  const source = await readFile(new URL("../src/lib/supabaseClient.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/layouts/SuperAdminLayout.jsx", import.meta.url), "utf8");
  const boardLayout = await readFile(new URL("../src/layouts/BoardLayout.jsx", import.meta.url), "utf8");
  const boardLogin = await readFile(new URL("../src/pages/auth/BoardLogin.jsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../src/utils/auth.js", import.meta.url), "utf8");
  const protectedRoute = await readFile(new URL("../src/components/ProtectedRoute.jsx", import.meta.url), "utf8");
  assert.match(source, /import\.meta\.env\.MODE === READ_ONLY_DASHBOARD_MODE/);
  assert.match(auth, /global: \{ fetch: guardedSupabaseFetch \}/);
  assert.equal((auth.match(/global: \{ fetch: guardedSupabaseFetch \}/g) || []).length, 1);
  assert.match(auth, /storageKey: `kandid-isolated-kiosk-\$\{\+\+isolatedStudentAuthClientSequence\}`/);
  assert.match(auth, /persistSession: false[\s\S]*?autoRefreshToken: false[\s\S]*?detectSessionInUrl: false/);
  assert.match(app, /LocalProductionReadOnlyRouteGate/);
  assert.match(layout, /database RLS and server authorization remain authoritative/);
  assert.match(boardLayout, /Read-only Electoral Board test connected to production data/);
  assert.match(boardLogin, /Local read-only test connected to production data/);
  assert.match(protectedRoute, /requireAdminRole\(role,\s*\{\s*requireOrganization:\s*role === "electoral_board"/);
});
