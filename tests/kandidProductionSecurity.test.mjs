import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_INVITE_REDIRECT_URL,
  KANDID_WEB_ORIGIN,
  corsHeaders,
  corsHeadersForOrigin,
  handleCorsPreflight,
  rejectDisallowedOrigin,
  resolveAdminInviteRedirect,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

test("trusted website receives the narrow POST preflight", () => {
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "OPTIONS",
    headers: {
      Origin: KANDID_WEB_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info, x-retry-count",
    },
  });
  const response = handleCorsPreflight(request);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), KANDID_WEB_ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
});

test("localhost read-only dashboard origin receives explicit preflight access", () => {
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type",
    },
  });
  const response = handleCorsPreflight(request);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
});

test("function responses reflect only an explicitly allowed request origin", () => {
  assert.equal(corsHeadersForOrigin("https://witkandid.vercel.app")["Access-Control-Allow-Origin"], KANDID_WEB_ORIGIN);
  assert.equal(corsHeadersForOrigin("http://localhost:5173")["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.equal(corsHeadersForOrigin("http://localhost:5174")["Access-Control-Allow-Origin"], "http://localhost:5174");
  assert.equal(corsHeadersForOrigin("http://127.0.0.1:5173"), null);
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "POST",
    headers: { Origin: "http://localhost:5173" },
  });
  const response = withKandidCors(request, new Response("ok", { status: 200 }));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.doesNotMatch(response.headers.get("Access-Control-Allow-Origin"), /\*/);
});

test("localhost:5174 receives allowed preflight while arbitrary origins are rejected", () => {
  const allowed = handleCorsPreflight(new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5174",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info, x-retry-count",
    },
  }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "http://localhost:5174");
  assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.match(allowed.headers.get("Access-Control-Allow-Headers"), /x-retry-count/);

  const rejected = handleCorsPreflight(new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "OPTIONS",
    headers: {
      Origin: "https://arbitrary.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type",
    },
  }));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
});

test("untrusted origins are rejected without an allow-origin header", () => {
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  });
  const response = rejectDisallowedOrigin(request);

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight permits origin-less server OPTIONS without granting browser access", () => {
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "POST" },
  });
  const response = handleCorsPreflight(request);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight rejects unsupported methods and unapproved headers", () => {
  const cases = [
    new Request("https://project.supabase.co/functions/v1/vote-access", {
      method: "OPTIONS",
      headers: { Origin: KANDID_WEB_ORIGIN, "Access-Control-Request-Method": "DELETE" },
    }),
    new Request("https://project.supabase.co/functions/v1/vote-access", {
      method: "OPTIONS",
      headers: {
        Origin: KANDID_WEB_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, x-unapproved-header",
      },
    }),
  ];

  for (const request of cases) assert.equal(handleCorsPreflight(request).status, 403);
});

test("non-browser requests retain server-side authentication handling", () => {
  const request = new Request("https://project.supabase.co/functions/v1/vote-access", {
    method: "POST",
    headers: { Authorization: "Bearer test-session" },
  });

  assert.equal(rejectDisallowedOrigin(request), null);
  assert.equal(corsHeaders["Access-Control-Allow-Origin"], KANDID_WEB_ORIGIN);
});

test("administrator invites use only the official setup route", () => {
  assert.equal(ADMIN_INVITE_REDIRECT_URL, "https://witkandid.vercel.app/admin-auth/setup");
  assert.equal(resolveAdminInviteRedirect(undefined), ADMIN_INVITE_REDIRECT_URL);
  assert.equal(resolveAdminInviteRedirect(ADMIN_INVITE_REDIRECT_URL), ADMIN_INVITE_REDIRECT_URL);
  assert.throws(() => resolveAdminInviteRedirect("https://attacker.example/admin-auth/setup"));
  assert.throws(() => resolveAdminInviteRedirect("https://witkandid.vercel.app/other-route"));
});

test("both production handlers preserve JWT and server-side role checks", async () => {
  const [adminSource, voteSource, config] = await Promise.all([
    readFile(new URL("../supabase/functions/admin-user-management/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/vote-access/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  for (const source of [adminSource, voteSource]) {
    assert.doesNotMatch(source, /Access-Control-Allow-Origin\s*:\s*["']\*["']/);
    assert.match(source, /handleCorsPreflight\(request\)/);
    assert.match(source, /rejectDisallowedOrigin\(request\)/);
    assert.match(source, /serveWithKandidCors\(async \(request\)/);
    assert.match(source, /authClient\.auth\.getUser\(\)/);
  }
  assert.match(adminSource, /adminProfile\.role !== "super_admin"/);
  assert.match(adminSource, /adminProfile\.status !== "active"/);
  assert.match(voteSource, /requireAdmin\(admin, authId, "super_admin"\)/);
  assert.match(voteSource, /profile\.role === "electoral_board" && !profile\.organization_id/);
  assert.match(config, /\[functions\.admin-user-management\]\s+verify_jwt\s*=\s*true/);
  assert.match(config, /\[functions\.vote-access\]\s+verify_jwt\s*=\s*true/);
});

test("all frontend-invoked functions have explicit gateway JWT requirements", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const requiredFunctions = [
    "resolve-student-login",
    "student-profile",
    "link-student-identity",
    "link-admin-identity",
    "vote-access",
    "submit-vote",
    "get-student-ballot-receipt",
    "organization-eligibility",
    "officers-contract",
    "board-manual-enrollment",
    "admin-academic-terms",
    "admin-user-management",
    "super-admin-manual-enrollment",
    "super-admin-masterlist-import",
    "student-notifications",
  ];
  const configured = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*(true|false)\s*$/gm)];
  const settings = new Map(configured.map(([, name, value]) => [name, value]));

  for (const name of requiredFunctions) {
    assert.equal(settings.has(name), true, `${name} must have explicit verify_jwt configuration`);
    assert.equal(settings.get(name), name === "resolve-student-login" ? "false" : "true", name);
  }
  for (const name of requiredFunctions.filter((item) => item !== "resolve-student-login")) {
    const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /auth\.getUser\(\)/, `${name} must resolve an authenticated Auth session`);
  }
  assert.deepEqual(
    [...settings.entries()].filter(([, value]) => value === "false").map(([name]) => name),
    ["resolve-student-login"],
  );
});

test("all twelve formerly wildcard handlers use the shared allowlist and reject hostile browser origins", async () => {
  const names = [
    "student-profile",
    "link-student-identity",
    "link-admin-identity",
    "submit-vote",
    "get-student-ballot-receipt",
    "organization-eligibility",
    "officers-contract",
    "board-manual-enrollment",
    "admin-academic-terms",
    "super-admin-manual-enrollment",
    "super-admin-masterlist-import",
    "student-notifications",
  ];
  const sources = await Promise.all(names.map((name) =>
    readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8")
  ));

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /Access-Control-Allow-Origin\s*:\s*["']\*["']/ , names[index]);
    assert.match(source, /from "\.\.\/_shared\/kandidProductionSecurity\.mjs"/, names[index]);
    assert.match(source, /handleCorsPreflight\(request\)/, names[index]);
    assert.match(source, /rejectDisallowedOrigin\(request\)/, names[index]);
    assert.match(source, /serveWithKandidCors\(async \(request(?::\s*Request)?\)/, names[index]);
    assert.ok(
      source.indexOf("handleCorsPreflight(request)") < source.indexOf("rejectDisallowedOrigin(request)"),
      `${names[index]} must process preflight before rejecting origins`,
    );
    assert.ok(
      source.indexOf("rejectDisallowedOrigin(request)") < source.indexOf('request.method !== "POST"'),
      `${names[index]} must reject disallowed origins before operation dispatch`,
    );
  }
});

test("pre-auth Student login keeps its explicit origin checks and includes approved shared development origins", async () => {
  const source = await readFile(new URL("../supabase/functions/resolve-student-login/index.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\/_shared\/kandidProductionSecurity\.mjs/);
  assert.match(source, /\.\.\.KANDID_WEB_ORIGINS/);
  assert.match(source, /isAllowedOrigin\(origin \|\| null\)/);
  assert.match(source, /STUDENT_AUTH_ALLOWED_ORIGINS/);
  assert.match(source, /x-retry-count/);
});
