import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { setupAdmission, setupRpc, setupTokenHash, newSetupToken, setupDetails, maskedSetupRecognition, type SetupStudent } from "../_shared/studentSetupAdmission.ts";
import { KANDID_WEB_ORIGINS } from "../_shared/kandidProductionSecurity.mjs";

const APP_ORIGINS = new Set(
  [
    ...KANDID_WEB_ORIGINS,
    ...(Deno.env.get("STUDENT_AUTH_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ],
);
const MAX_BODY_BYTES = 8_192;
const MIN_FAILED_LOGIN_MS = 800;
const encoder = new TextEncoder();

function response(body: Record<string, unknown>, status: number, origin?: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && APP_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Expose-Headers", "Retry-After");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function genericLoginFailure(origin?: string) {
  return response({ data: { authenticated: false } }, 401, origin);
}

async function genericSetupResponse(origin: string | undefined, startedAt: number) {
  const remaining = MIN_FAILED_LOGIN_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  // A uniform acknowledgement, never a claim that email was delivered. SMTP
  // outcomes must not reveal whether a Student ID/email exists.
  return response({ data: { verification_requested: true, delivery_confirmed: false, retry_after_seconds: 60 } }, 202, origin);
}

function isAllowedOrigin(origin: string | null) {
  if (!origin || !APP_ORIGINS.has(origin)) return false;
  try {
    return new URL(origin).protocol === "https:" || new URL(origin).hostname === "localhost" || new URL(origin).hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      chunks.reduce((all, chunk) => {
        const next = new Uint8Array(all.length + chunk.length);
        next.set(all);
        next.set(chunk, all.length);
        return next;
      }, new Uint8Array()),
    );
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizedStudentNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[0-9]{1,20}$/.test(normalized) ? normalized : null;
}

function remoteAddress(request: Request): string | null {
  // Only trust the address injected by the Supabase/Cloudflare edge proxy.
  const address = request.headers.get("cf-connecting-ip")?.trim() || "";
  if (address && address.length <= 64) return address;

  // The isolated Supabase CLI stack has no Cloudflare proxy header. Use one
  // fixed local bucket only when the server-side Supabase URL is the CLI Kong
  // service, never a caller-provided forwarding header or cloud endpoint.
  try {
    const localSupabaseUrl = new URL(Deno.env.get("SUPABASE_URL") || "");
    if (localSupabaseUrl.protocol === "http:" && localSupabaseUrl.hostname === "kong" && localSupabaseUrl.port === "8000") {
      return "local-supabase-test";
    }
  } catch {
    return null;
  }

  return null;
}

async function keyedFingerprint(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(adminClient: ReturnType<typeof authClient>, secret: string, ip: string, studentNumber: string, operation: "login" | "setup" | "verify") {
  const [requesterFingerprint, studentFingerprint] = await Promise.all([
    keyedFingerprint(secret, `ip:${ip}`),
    keyedFingerprint(secret, `student:${studentNumber}`),
  ]);
  const { data, error } = await adminClient.rpc("kandid_consume_student_auth_rate_limit", {
    p_requester_fingerprint: requesterFingerprint,
    p_student_fingerprint: studentFingerprint,
    p_operation: operation,
  });
  return !error && data === true;
}

async function findAuthUserByEmail(adminClient: ReturnType<typeof authClient>, email: string) {
  const perPage = 1_000;
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users) return { user: null, failed: true };
    const matches = data.users.filter((user) => normalizeEmail(user.email) === email);
    if (matches.length > 1) return { user: null, failed: true };
    if (matches.length === 1) return { user: matches[0], failed: false };
    if (data.users.length < perPage) return { user: null, failed: false };
  }
  // Fail closed if the Auth directory exceeds the bounded lookup window.
  return { user: null, failed: true };
}

async function hasConflictingIdentityLink(adminClient: ReturnType<typeof authClient>, authUserId: string, studentId: number) {
  const [{ data: studentLinks, error: studentLinkError }, { data: adminLinks, error: adminLinkError }] = await Promise.all([
    adminClient.from("students").select("id").eq("auth_user_id", authUserId).limit(2),
    adminClient.from("admin_users").select("id").eq("auth_user_id", authUserId).limit(1),
  ]);
  if (studentLinkError || adminLinkError || (adminLinks || []).length > 0) return true;
  return (studentLinks || []).some((link) => Number(link.id) !== studentId);
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function setupStudentRecord(admin: ReturnType<typeof authClient>, number: string,
  user?: {id: string; email?: string; email_confirmed_at?: string}, expectedId?: number) {
  const record = await setupAdmission(admin, number, user);
  return record && (expectedId === undefined || Number(record.id) === expectedId) ? record : null;
}

function authClient(url: string, anonKey: string) {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (request) => {
  const requestStartedAt = Date.now();
  const origin = request.headers.get("origin") || undefined;
  if (request.method === "OPTIONS") {
    return isAllowedOrigin(origin || null)
      ? new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin!,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      } })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST" || !isAllowedOrigin(origin || null)) {
    return response({ error: "Request could not be processed." }, 403, origin);
  }

  const body = await readBoundedJson(request);
  const studentNumber = normalizedStudentNumber(body?.student_number);
  const action = body?.action === undefined ? "login" : body.action;
  if (!body || !studentNumber || !["login", "inspect_setup", "begin_access", "verify_access"].includes(String(action))) {
    return action === "begin_access"
      ? genericSetupResponse(origin, requestStartedAt)
      : genericLoginFailure(origin);
  }
  if (action === "inspect_setup" && Object.keys(body).some((key) => !["action", "student_number"].includes(key))) {
    return genericLoginFailure(origin);
  }
  if (action === "begin_access" && Object.keys(body).some(key => !["action","student_number"].includes(key))) {
    return genericSetupResponse(origin, requestStartedAt);
  }
  if (action === "verify_access" && Object.keys(body).some(key => !["action","student_number","verification_code"].includes(key))) {
    return genericLoginFailure(origin);
  }
  if (action !== "login" && Deno.env.get("STUDENT_SETUP_SECURITY_ENABLED") !== "true") {
    return response({error: "Student setup is unavailable."}, 503, origin);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hmacSecret = Deno.env.get("STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET");
  const ip = remoteAddress(request);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !hmacSecret || hmacSecret.length < 32 || !ip) {
    return response({ error: "Authentication is temporarily unavailable." }, 503, origin);
  }

  const password = action === "login" && typeof body.password === "string" && body.password.length > 0 && body.password.length <= 256
    ? body.password
    : null;
  if (action === "login" && !password) return genericLoginFailure(origin);
  const registeredEmail = typeof body.registered_email === "string" && body.registered_email.length <= 320
    ? normalizeEmail(body.registered_email)
    : "";
  const verificationCode = typeof body.verification_code === "string" && /^[0-9]{6}$/.test(body.verification_code)
    ? body.verification_code
    : null;
  if (action === "verify_access" && !verificationCode) return genericLoginFailure(origin);
  // Legacy callers may supply the email, but it never selects the Auth target.
  // New setup callers send only the Student ID and code; the trusted record
  // supplies the same email used by begin_access without disclosing it publicly.
  if (action === "verify_access" && Object.hasOwn(body, "registered_email") && (!registeredEmail || !registeredEmail.includes("@"))) {
    return genericLoginFailure(origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let rateAllowed: boolean;
  try {
    const operation = action === "begin_access" ? "setup" : ["verify_access", "inspect_setup"].includes(String(action)) ? "verify" : "login";
    rateAllowed = await enforceRateLimit(adminClient, hmacSecret, ip, studentNumber, operation);
  } catch {
    return response({ error: "Authentication is temporarily unavailable." }, 503, origin);
  }
  if (!rateAllowed) {
    // These HMAC buckets apply to every ID before lookup, so exposing this
    // cooldown does not disclose eligibility or account existence.
    const limited = response({ data: action === "begin_access" ? { verification_requested: false } : { authenticated: false } }, 429, origin);
    limited.headers.set("Retry-After", "900");
    return limited;
  }

  if (action === "inspect_setup") {
    // Masked recognition uses the same authoritative admission contract as OTP
    // dispatch, verification and linking. Only an admitted pending record
    // yields masked display fields; unknown, disabled, already-active and
    // conflicting identities share one generic rejection. Masking happens
    // here on the server — unmasked names, email and identifiers never leave.
    let admitted: SetupStudent | null;
    try { admitted = await setupStudentRecord(adminClient, studentNumber); }
    catch { return response({error: "Authentication is temporarily unavailable."}, 503, origin); }
    const remaining = MIN_FAILED_LOGIN_MS - (Date.now() - requestStartedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (!admitted || admitted.status !== "pending") {
      return response({error: "Student details unavailable."}, 404, origin);
    }
    return response({data: {recognition_version: 4, student_number: studentNumber, verification_required: true,
      ...maskedSetupRecognition(admitted)}}, 200, origin);
  }

  const auth = authClient(supabaseUrl, anonKey);
  const startedAt = Date.now();
  const { data: studentRows, error: lookupError } = await adminClient
    .from("students")
    .select("id, auth_user_id, student_number, email, status")
    .eq("student_number", studentNumber)
    .limit(2);
  let student = !lookupError && studentRows?.length === 1 ? studentRows[0] : null;
  if (action !== "login") {
    try { student = await setupStudentRecord(adminClient, studentNumber); }
    catch { return response({error: "Authentication is temporarily unavailable."}, 503, origin); }
  }
  const eligibleForLogin = Boolean(
    action === "login" && student?.status === "active" && student.auth_user_id && normalizeEmail(student.email),
  );

  if (action === "begin_access") {
    const eligibleForVerification = Boolean(
      student && (student.status === "active" || (student.status === "pending" && !student.auth_user_id)) && normalizeEmail(student.email),
    );
    if (eligibleForVerification && student) {
      const email = normalizeEmail(student.email);
      let authUser: Awaited<ReturnType<typeof findAuthUserByEmail>>["user"];
      if (student.auth_user_id) {
        const { data, error } = await adminClient.auth.admin.getUserById(student.auth_user_id);
        authUser = !error && normalizeEmail(data.user?.email) === email ? data.user : null;
        if (error || !authUser) return genericSetupResponse(origin, requestStartedAt);
      } else {
        const lookup = await findAuthUserByEmail(adminClient, email);
        if (lookup.failed) return genericSetupResponse(origin, requestStartedAt);
        authUser = lookup.user;
        if (!authUser) {
          const { data, error } = await adminClient.auth.admin.createUser({
            email,
            email_confirm: false,
          });
          if (error || !data.user) return genericSetupResponse(origin, requestStartedAt);
          authUser = data.user;
        }
      }

      if (await hasConflictingIdentityLink(adminClient, authUser.id, Number(student.id)) ||
          !await setupStudentRecord(adminClient, studentNumber)) {
        return genericSetupResponse(origin, requestStartedAt);
      }

      try {
        const { error } = await auth.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (error) console.warn(error.status === 429
          ? "[resolve-student-login] verification dispatch throttled"
          : "[resolve-student-login] verification dispatch failed");
      } catch {
        console.warn("[resolve-student-login] verification dispatch failed");
      }
    } else {
      const decoyEmail = `unknown-${await keyedFingerprint(hmacSecret, `dummy:${studentNumber}`)}@invalid.example`;
      await auth.auth.signInWithOtp({
        email: decoyEmail,
        options: { shouldCreateUser: false },
      }).catch(() => undefined);
    }
    return genericSetupResponse(origin, requestStartedAt);
  }

  if (action === "verify_access") {
    const storedEmail = normalizeEmail(student?.email);
    const eligibleForVerification = Boolean(
      student && ["active", "pending"].includes(String(student.status)) && storedEmail &&
      (!Object.hasOwn(body, "registered_email") || registeredEmail === storedEmail) &&
      (student.status === "active" || !student.auth_user_id),
    );
    const targetEmail = eligibleForVerification
      ? storedEmail
      : `unknown-${await keyedFingerprint(hmacSecret, `dummy:${studentNumber}`)}@invalid.example`;
    let verification: Awaited<ReturnType<ReturnType<typeof authClient>["auth"]["verifyOtp"]>> | null;
    try {
      verification = await auth.auth.verifyOtp({
        email: targetEmail,
        token: verificationCode!,
        type: "email",
      });
    } catch {
      verification = null;
    }
    const verifiedSession = verification?.data?.session;
    const verifiedUser = verification?.data?.user;
    const identityMatches = eligibleForVerification && verifiedSession && verifiedUser?.email_confirmed_at &&
      normalizeEmail(verifiedUser.email) === storedEmail &&
      (!student?.auth_user_id || verification?.data?.user?.id === student.auth_user_id);
    if (!identityMatches || !verifiedSession?.access_token || !verifiedSession?.refresh_token) {
      const remaining = MIN_FAILED_LOGIN_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      return genericLoginFailure(origin);
    }
    const setupToken = newSetupToken();
    let issued;
    try {
      issued = await setupRpc(adminClient, "kandid_student_setup_issue_v1", {
        p_student_number: studentNumber, p_auth_user_id: verifiedUser!.id,
        p_expected_email: verifiedUser!.email, p_proof_hash: await setupTokenHash(setupToken),
      });
    } catch {
      return response({error: "Account admission could not be confirmed.", code: "setup_recognition_unavailable"}, 503, origin);
    }
    if (!issued) return genericLoginFailure(origin);
    const admitted = issued.student as SetupStudent;
    return response({ data: { authenticated: true, setup_verification: {
      contract_version: 3, student_number: studentNumber, auth_user_id: verifiedUser!.id,
      account_state: issued.account_state, student_details: setupDetails(admitted),
      setup_token: issued.account_state === "pending" ? setupToken : null,
      expires_at: issued.account_state === "pending" ? issued.expires_at : null,
    }, session: {
      access_token: verifiedSession.access_token,
      refresh_token: verifiedSession.refresh_token,
      expires_in: verifiedSession.expires_in,
      expires_at: verifiedSession.expires_at,
      token_type: verifiedSession.token_type,
    } } }, 200, origin);
  }

  const targetEmail = eligibleForLogin
    ? normalizeEmail(student?.email)
    : `unknown-${await keyedFingerprint(hmacSecret, `dummy:${studentNumber}`)}@invalid.example`;
  let signIn: Awaited<ReturnType<ReturnType<typeof authClient>["auth"]["signInWithPassword"]>> | null;
  try {
    signIn = await auth.auth.signInWithPassword({
      email: targetEmail,
      password: password!,
    });
  } catch {
    signIn = null;
  }

  const validSession = eligibleForLogin && !lookupError && signIn?.data?.session &&
    signIn.data.user?.id === student?.auth_user_id &&
    typeof signIn.data.session.access_token === "string" &&
    typeof signIn.data.session.refresh_token === "string";

  if (!validSession) {
    const remaining = MIN_FAILED_LOGIN_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (lookupError) return response({ error: "Authentication is temporarily unavailable." }, 503, origin);
    return genericLoginFailure(origin);
  }

  const session = signIn!.data.session!;
  return response({ data: { authenticated: true, session: {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
  } } }, 200, origin);
});
