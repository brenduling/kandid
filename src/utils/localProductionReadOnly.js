export const READ_ONLY_DASHBOARD_MODE = "localhost-production-readonly";

const OFFICIAL_SUPABASE_ORIGIN = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const PUBLIC_READABLE_TABLES = new Set(["organizations", "elections"]);
const SUPER_ADMIN_READABLE_TABLES = new Set([
  ...PUBLIC_READABLE_TABLES,
  "students",
  "admin_users",
]);
const BOARD_READABLE_TABLES = new Set([
  ...PUBLIC_READABLE_TABLES,
  "admin_users",
  "positions",
  "candidates",
]);
const SAFE_AUTH_READS = new Set(["/auth/v1/user"]);
const READ_ONLY_RPC_PATHS = new Set([
  "rpc/kandid_server_time",
]);
const SUPER_ADMIN_READ_ONLY_RPC_PATHS = new Set([
  "rpc/kandid_list_super_admin_audit_events",
]);
const BOARD_READ_ONLY_RPC_PATHS = new Set([
  "rpc/kandid_list_board_audit_events",
  "rpc/kandid_list_board_report_elections",
  "rpc/kandid_get_board_election_report_package",
  "rpc/kandid_get_board_voting_monitor",
]);

export const LOCAL_PRODUCTION_READONLY_PATHS = new Set([
  "/admin-login",
  "/super-admin",
  "/super-admin/dashboard",
  "/board-login",
  "/eb-login",
  "/board-portal",
  "/board",
  "/board/dashboard",
  "/board/positions",
  "/board/candidates",
  "/board/voting-monitor",
  "/board/reports",
  "/board/audit-trail",
]);

export const LOCAL_PRODUCTION_READONLY_BOARD_PATHS = new Set([
  "/board/dashboard",
  "/board/positions",
  "/board/candidates",
  "/board/voting-monitor",
  "/board/reports",
  "/board/audit-trail",
]);

export function isAllowedLocalProductionReadonlyPath(pathname) {
  const normalizedPath = String(pathname || "/").replace(/\/$/, "") || "/";
  return LOCAL_PRODUCTION_READONLY_PATHS.has(normalizedPath);
}

export function localProductionReadonlyRedirect(pathname) {
  const normalizedPath = String(pathname || "/").replace(/\/$/, "") || "/";
  if (normalizedPath.startsWith("/board") || normalizedPath.startsWith("/eb-")) {
    return "/eb-login";
  }
  return "/admin-login";
}

function getRequestUrl(input) {
  if (input instanceof Request) return input.url;
  return String(input || "");
}

function getRequestBody(body) {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function isAllowedLocalProductionDashboardRequest({
  input,
  method,
  body,
  role,
}) {
  let url;
  try {
    url = new URL(getRequestUrl(input));
  } catch {
    return false;
  }

  if (url.origin !== OFFICIAL_SUPABASE_ORIGIN) return false;

  const requestMethod = String(method || "GET").toUpperCase();
  const path = url.pathname;

  if (path === "/auth/v1/token" && requestMethod === "POST") {
    return new Set(["password", "refresh_token"]).has(url.searchParams.get("grant_type"));
  }
  if (path === "/auth/v1/logout" && requestMethod === "POST") return true;
  if (SAFE_AUTH_READS.has(path) && requestMethod === "GET") return true;

  if (path.startsWith("/rest/v1/")) {
    const resource = path.slice("/rest/v1/".length);
    if (requestMethod === "GET" || requestMethod === "HEAD") {
      if (PUBLIC_READABLE_TABLES.has(resource)) return true;
      // Route authentication loads exactly the caller's linked admin profile;
      // production RLS restricts this table to auth_user_id = auth.uid().
      if (resource === "admin_users") return true;
      if (role === "super_admin" && SUPER_ADMIN_READABLE_TABLES.has(resource)) return true;
      if (role === "electoral_board" && BOARD_READABLE_TABLES.has(resource)) return true;
    }
    if (requestMethod !== "POST") return false;
    if (READ_ONLY_RPC_PATHS.has(resource)) return true;
    if (role === "super_admin" && SUPER_ADMIN_READ_ONLY_RPC_PATHS.has(resource)) return true;
    return role === "electoral_board" && BOARD_READ_ONLY_RPC_PATHS.has(resource);
  }

  if (path === "/functions/v1/vote-access" && requestMethod === "POST") {
    const parsedBody = getRequestBody(body);
    if (!parsedBody) return false;
    if (role === "super_admin") {
      return parsedBody.action === "super_admin_vote_count" && Object.keys(parsedBody).length === 1;
    }
    return role === "electoral_board" &&
      parsedBody.action === "board_dashboard_counts" &&
      Object.keys(parsedBody).length === 2 &&
      Array.isArray(parsedBody.election_ids) &&
      parsedBody.election_ids.length > 0 &&
      parsedBody.election_ids.length <= 2000 &&
      parsedBody.election_ids.every((id) => Number.isSafeInteger(id) && id > 0);
  }

  return false;
}
