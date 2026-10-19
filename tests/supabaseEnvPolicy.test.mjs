import test from "node:test";
import assert from "node:assert/strict";
import { validateSupabaseBuildEnvironment } from "../scripts/supabase-env-policy.js";

const officialRef = "fszgdxqxonqqcrzsnkca";
const oldRef = "jkkgzhteacaafdnpeomy";

function legacyAnonKey(ref, role = "anon") {
  const payload = Buffer.from(JSON.stringify({ ref, role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

test("production accepts only the official URL and matching legacy anonymous key", () => {
  assert.deepEqual(validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: legacyAnonKey(officialRef),
  }), { target: officialRef, mode: "production" });
});

test("production rejects the retired project URL or a mismatched legacy key", () => {
  assert.throws(() => validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: `https://${oldRef}.supabase.co`,
    VITE_SUPABASE_KEY: legacyAnonKey(oldRef),
  }), /retired Supabase project/);
  assert.throws(() => validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: legacyAnonKey(oldRef),
  }), /does not identify the official project/);
});

test("production rejects missing, malformed, and elevated client keys", () => {
  const url = `https://${officialRef}.supabase.co`;
  assert.throws(() => validateSupabaseBuildEnvironment("production", { VITE_SUPABASE_URL: url }), /public client key/);
  assert.throws(() => validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_KEY: legacyAnonKey(officialRef, "service_role"),
  }), /public key does not identify/);
  assert.throws(() => validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_KEY: "sb_secret_do_not_use",
  }), /server-only/);
});

test("production accepts a publishable key only with the official-project attestation", () => {
  assert.throws(() => validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: "sb_publishable_example",
  }), /attest that the publishable key came from the official project/);
  assert.deepEqual(validateSupabaseBuildEnvironment("production", {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: "sb_publishable_example",
    KANDID_SUPABASE_KEY_PROJECT_REF: officialRef,
  }), { target: officialRef, mode: "production" });
});

test("explicit localhost production-readonly mode requires its marker and official public key", () => {
  const env = {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: "sb_publishable_test_value",
    KANDID_SUPABASE_KEY_PROJECT_REF: officialRef,
    KANDID_LOCAL_PRODUCTION_READONLY: "true",
  };
  assert.deepEqual(validateSupabaseBuildEnvironment("localhost-production-readonly", env), {
    target: officialRef,
    mode: "localhost-production-readonly",
    readOnly: true,
  });
  assert.throws(() => validateSupabaseBuildEnvironment("localhost-production-readonly", {
    ...env,
    KANDID_LOCAL_PRODUCTION_READONLY: undefined,
  }), /explicit read-only opt-in/);
  assert.throws(() => validateSupabaseBuildEnvironment("localhost-production-readonly", {
    ...env,
    VITE_SUPABASE_URL: `https://${oldRef}.supabase.co`,
  }), /retired Supabase project/);
  assert.throws(() => validateSupabaseBuildEnvironment("localhost-production-readonly", {
    ...env,
    VITE_SUPABASE_KEY: "sb_publishable_wrong_target",
    KANDID_SUPABASE_KEY_PROJECT_REF: "wrong-project",
  }), /attest that the publishable key came from the official project/);
});

test("test mode accepts an explicit local Supabase endpoint", () => {
  assert.deepEqual(validateSupabaseBuildEnvironment("test", {
    VITE_SUPABASE_URL: "http://127.0.0.1:57321",
    VITE_SUPABASE_KEY: legacyAnonKey("local-kandid"),
  }), { target: "local", mode: "test" });
});

test("development accepts only the official project with its public key attestation", () => {
  const env = {
    VITE_SUPABASE_URL: `https://${officialRef}.supabase.co`,
    VITE_SUPABASE_KEY: "sb_publishable_test_value",
    KANDID_SUPABASE_KEY_PROJECT_REF: officialRef,
  };
  assert.deepEqual(validateSupabaseBuildEnvironment("development", env), {
    target: officialRef,
    mode: "development",
  });
  assert.throws(() => validateSupabaseBuildEnvironment("development", {
    ...env,
    VITE_SUPABASE_URL: "http://127.0.0.1:55321",
  }), /official KANDID Supabase project URL/);
  assert.throws(() => validateSupabaseBuildEnvironment("development", {
    ...env,
    VITE_SUPABASE_URL: `https://${oldRef}.supabase.co`,
  }), /retired Supabase project/);
  assert.throws(() => validateSupabaseBuildEnvironment("development", {
    ...env,
    KANDID_SUPABASE_KEY_PROJECT_REF: oldRef,
  }), /attest that the publishable key came from the official project/);
  assert.throws(() => validateSupabaseBuildEnvironment("development", {
    ...env,
    VITE_SUPABASE_KEY: "sb_secret_forbidden",
  }), /server-only/);
});
