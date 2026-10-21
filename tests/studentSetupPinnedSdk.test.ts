import assert from "node:assert/strict";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

// Exercise the exact release SDK with synthetic HTTP responses. Deno runs these
// tests with no network permission; an unexpected request cannot reach production.
const student = { id: 42, student_number: "700001", status: "active", auth_user_id: "00000000-0000-4000-8000-000000000042", email: "student@example.invalid" };
const user = { id: student.auth_user_id, email: student.email, email_confirmed_at: "2026-10-17T00:00:00Z" };
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer", user };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

function fixture(respond: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const client = createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, "https://synthetic.invalid");
      calls.push({ url, init });
      return Promise.resolve(respond(url, init));
    } },
  });
  return { client, calls };
}

Deno.test("pinned SDK preserves rate-limit RPC and scoped student lookup contracts", async () => {
  const h = fixture((url, init) => {
    if (url.pathname.endsWith("/rpc/kandid_consume_student_auth_rate_limit")) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(String(init.body)), {
        p_requester_fingerprint: "synthetic-ip", p_student_fingerprint: "synthetic-id", p_operation: "verify",
      });
      return json(true);
    }
    assert.equal(url.pathname, "/rest/v1/students");
    assert.equal(url.searchParams.get("student_number"), "eq.700001");
    assert.equal(url.searchParams.get("limit"), "2");
    return json([student]);
  });
  const limited = await h.client.rpc("kandid_consume_student_auth_rate_limit", {
    p_requester_fingerprint: "synthetic-ip", p_student_fingerprint: "synthetic-id", p_operation: "verify",
  });
  assert.equal(limited.error, null);
  assert.equal(limited.data, true);
  const lookup = await h.client.from("students").select("id,auth_user_id,student_number,email,status").eq("student_number", student.student_number).limit(2);
  assert.equal(lookup.error, null);
  assert.deepEqual(lookup.data, [student]);
  assert.equal(h.calls.length, 2);
});

Deno.test("pinned SDK preserves password login sessions and explicit rejection", async () => {
  for (const rejected of [false, true]) {
    const h = fixture((url, init) => {
      assert.equal(url.pathname, "/auth/v1/token");
      assert.equal(url.searchParams.get("grant_type"), "password");
      assert.equal(JSON.parse(String(init.body)).email, student.email);
      return rejected ? json({ message: "Synthetic rejection", code: "invalid_credentials" }, 400) : json(session);
    });
    const result = await h.client.auth.signInWithPassword({ email: student.email, password: "Synthetic!9" });
    assert.equal(Boolean(result.error), rejected);
    assert.equal(result.data.session?.access_token || null, rejected ? null : session.access_token);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("pinned SDK preserves admin identity lookup, unconfirmed creation and stored-email OTP dispatch", async () => {
  const h = fixture((url, init) => {
    if (url.pathname === "/auth/v1/admin/users" && init.method === "GET") return json({ users: [user], aud: "authenticated" });
    if (url.pathname === "/auth/v1/admin/users" && init.method === "POST") {
      assert.equal(JSON.parse(String(init.body)).email_confirm, false);
      return json(user);
    }
    if (url.pathname === `/auth/v1/admin/users/${user.id}`) return json(user);
    assert.equal(url.pathname, "/auth/v1/otp");
    const body = JSON.parse(String(init.body));
    assert.equal(body.email, student.email);
    assert.equal(body.create_user, false);
    return json({});
  });
  assert.deepEqual((await h.client.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users, [user]);
  assert.equal((await h.client.auth.admin.getUserById(user.id)).data.user?.id, user.id);
  assert.equal((await h.client.auth.admin.createUser({ email: student.email, email_confirm: false })).data.user?.id, user.id);
  assert.equal((await h.client.auth.signInWithOtp({ email: student.email, options: { shouldCreateUser: false } })).error, null);
  assert.equal(h.calls.length, 4);
});

Deno.test("pinned SDK preserves verified-email OTP session and invalid-code failure", async () => {
  for (const rejected of [false, true]) {
    const h = fixture((url, init) => {
      assert.equal(url.pathname, "/auth/v1/verify");
      const body = JSON.parse(String(init.body));
      assert.equal(body.email, student.email);
      assert.equal(body.token, "000000");
      assert.equal(body.type, "email");
      return rejected ? json({ message: "Synthetic expired code", code: "otp_expired" }, 403) : json(session);
    });
    const result = await h.client.auth.verifyOtp({ email: student.email, token: "000000", type: "email" });
    assert.equal(Boolean(result.error), rejected);
    assert.equal(result.data.user?.email_confirmed_at || null, rejected ? null : user.email_confirmed_at);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("pinned SDK preserves protected inspection and explicit HTTP error contexts without retry", async () => {
  for (const status of [200, 401, 403, 429, 503]) {
    const expected = { data: { verification_required: true, student_details: { student_number: "700001", details_verified: false } } };
    const h = fixture((url, init) => {
      assert.equal(url.pathname, "/functions/v1/resolve-student-login");
      assert.deepEqual(JSON.parse(String(init.body)), { action: "inspect_setup", student_number: "700001" });
      return json(status === 200 ? expected : { data: { authenticated: false } }, status);
    });
    const result = await h.client.functions.invoke("resolve-student-login", { body: { action: "inspect_setup", student_number: "700001" } });
    if (status === 200) {
      assert.equal(result.error, null);
      assert.deepEqual(result.data, expected);
    } else {
      assert.equal(result.error?.name, "FunctionsHttpError");
      assert.equal(result.error?.context.status, status);
    }
    assert.equal(h.calls.length, 1);
  }
});
