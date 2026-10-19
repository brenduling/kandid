import { Buffer } from "node:buffer";

export const OFFICIAL_SUPABASE_PROJECT_REF = "fszgdxqxonqqcrzsnkca";
export const RETIRED_SUPABASE_PROJECT_REF = "jkkgzhteacaafdnpeomy";
export const LOCAL_PRODUCTION_READONLY_MODE = "localhost-production-readonly";
export const OFFICIAL_DEVELOPMENT_MODE = "development";

function readLegacyAnonClaims(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseProjectRef(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid URL for this build mode.");
  }

  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  return { url, projectRef: match?.[1]?.toLowerCase() || null };
}

export function validateSupabaseBuildEnvironment(mode, env) {
  const { url, projectRef } = parseProjectRef(env.VITE_SUPABASE_URL || "");
  const key = String(env.VITE_SUPABASE_KEY || "").trim();

  if (projectRef === RETIRED_SUPABASE_PROJECT_REF || key.includes(RETIRED_SUPABASE_PROJECT_REF)) {
    throw new Error("Build blocked: the retired Supabase project is not a valid KANDID target.");
  }

  if (mode === "production" || mode === LOCAL_PRODUCTION_READONLY_MODE || mode === OFFICIAL_DEVELOPMENT_MODE) {
    if (
      mode === LOCAL_PRODUCTION_READONLY_MODE &&
      env.KANDID_LOCAL_PRODUCTION_READONLY !== "true"
    ) {
      throw new Error("Local production testing blocked: explicit read-only opt-in is required.");
    }
    if (
      url.protocol !== "https:" ||
      projectRef !== OFFICIAL_SUPABASE_PROJECT_REF ||
      url.pathname !== "/" || url.search || url.hash
    ) {
      throw new Error(`${mode} build blocked: configure the official KANDID Supabase project URL.`);
    }
    if (!key) {
      throw new Error(`${mode} build blocked: configure the official project's public client key.`);
    }
    if (/^(sb_secret_|service_role)/i.test(key)) {
      throw new Error(`${mode} build blocked: a server-only Supabase key cannot be used in the browser.`);
    }

    if (key.startsWith("sb_publishable_")) {
      if (env.KANDID_SUPABASE_KEY_PROJECT_REF !== OFFICIAL_SUPABASE_PROJECT_REF) {
        throw new Error(`${mode} build blocked: attest that the publishable key came from the official project.`);
      }
    } else {
      const claims = readLegacyAnonClaims(key);
      if (claims?.ref !== OFFICIAL_SUPABASE_PROJECT_REF || claims?.role !== "anon") {
        throw new Error(`${mode} build blocked: the public key does not identify the official project.`);
      }
    }
    if (mode === LOCAL_PRODUCTION_READONLY_MODE) {
      return { target: OFFICIAL_SUPABASE_PROJECT_REF, mode, readOnly: true };
    }
    return { target: OFFICIAL_SUPABASE_PROJECT_REF, mode };
  }

  if (projectRef) {
    throw new Error("Non-production Vite mode blocked: cloud Supabase targets are not allowed for local testing.");
  }
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname.toLowerCase())) {
    throw new Error("Non-production Vite mode blocked: use an explicitly configured local Supabase endpoint.");
  }
  if (url.protocol !== "http:" || !key) {
    throw new Error("Non-production Vite mode blocked: a local HTTP endpoint and public client key are required.");
  }
  const claims = readLegacyAnonClaims(key);
  if (claims?.role === "service_role" || key.startsWith("sb_secret_")) {
    throw new Error("Vite build blocked: server-only Supabase keys cannot be used in the browser.");
  }

  return { target: "local", mode };
}
