import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const roles = new Set(["super_admin", "electoral_board"]);
const statuses = new Set(["active", "disabled"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 320).toLowerCase();
}

function hasConfirmedEmail(user: Record<string, unknown>) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function sanitizeDbError(error: { code?: string; message?: string } | null) {
  if (!error) return "Request failed.";
  if (error.code === "23505") return "An administrator with this email or identity already exists.";
  if (error.code === "23503") return "The selected organization is not valid.";
  return "The administrator request could not be completed.";
}

function logStage(stage: string, details: Record<string, unknown> = {}) {
  console.log(`[admin-user-management] ${stage}`, details);
}

function logFailure(stage: string, error: { code?: string; message?: string } | Error | null) {
  const safeError = error as { code?: string; message?: string } | null;
  console.error(`[admin-user-management] ${stage}`, {
    code: safeError?.code || null,
    message: safeError?.message || "Request failed.",
  });
}

function toSafeAdmin(row: Record<string, unknown>) {
  const organization = row.organizations as Record<string, unknown> | null | undefined;

  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    organization_id: row.organization_id,
    status: row.status,
    photo_url: row.photo_url,
    created_at: row.created_at,
    auth_linked: Boolean(row.auth_user_id),
    organizations: organization
      ? {
          id: organization.id,
          name: organization.name,
        }
      : null,
  };
}

async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 100;

  while (page <= 100) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return { user: null, error };
    }

    const user = (data.users || []).find(
      (item) => String(item.email || "").trim().toLowerCase() === email,
    );
    if (user) return { user, error: null };
    if ((data.users || []).length < perPage) break;
    page += 1;
  }

  return { user: null, error: null };
}

async function findAuthUsersByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 100;
  const matches: Record<string, unknown>[] = [];

  while (page <= 100) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return { users: [], error };
    }

    (data.users || []).forEach((item) => {
      if (normalizeEmail(item.email) === email) {
        matches.push(item as unknown as Record<string, unknown>);
      }
    });

    if (matches.length > 1 || (data.users || []).length < perPage) break;
    page += 1;
  }

  return { users: matches, error: null };
}

async function requireSuperAdmin(request: Request, supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return { response: jsonResponse({ error: "Authentication required." }, 401) };

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id) {
    return { response: jsonResponse({ error: "Invalid or expired session." }, 401) };
  }

  logStage("auth-user-resolved", { user_id: user.id });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });

  logStage("admin-profile-query-start");

  const { data: adminProfile, error: adminError } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (adminError) {
    logFailure("admin-profile-query-failed", adminError);
    return { response: jsonResponse({ error: "Unable to verify administrator access." }, 500) };
  }

  if (
    !adminProfile ||
    adminProfile.auth_user_id !== user.id ||
    adminProfile.role !== "super_admin" ||
    adminProfile.status !== "active"
  ) {
    return { response: jsonResponse({ error: "Super Admin authorization required." }, 403) };
  }

  return { adminClient, user, adminProfile };
}

async function organizationExists(adminClient: ReturnType<typeof createClient>, organizationId: number) {
  logStage("organizations-query-start", { organization_id: organizationId });

  const { data, error } = await adminClient
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    logFailure("organizations-query-failed", error);
  }

  return !error && Boolean(data);
}

async function validateAdminPayload(adminClient: ReturnType<typeof createClient>, input: Record<string, unknown>) {
  const fullName = cleanText(input.full_name);
  const email = normalizeEmail(input.email);
  const role = cleanText(input.role);
  const status = cleanText(input.status || "active");
  const photoUrl = cleanText(input.photo_url || "", 2000) || null;
  const organizationId =
    input.organization_id === null || input.organization_id === "" || input.organization_id === undefined
      ? null
      : Number(input.organization_id);

  if (!fullName) throw new Error("Full name is required.");
  if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
  if (!roles.has(role)) throw new Error("Choose a supported administrator role.");
  if (!statuses.has(status)) throw new Error("Choose a supported account status.");

  if (role === "super_admin") {
    return { full_name: fullName, email, role, status, organization_id: null, photo_url: photoUrl };
  }

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error("Electoral Board accounts require an assigned organization.");
  }

  if (!(await organizationExists(adminClient, organizationId))) {
    throw new Error("The selected organization is not valid.");
  }

  return { full_name: fullName, email, role, status, organization_id: organizationId, photo_url: photoUrl };
}

Deno.serve(async (request) => {
  logStage("start", { method: request.method });

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const inviteRedirectTo = Deno.env.get("KANDID_ADMIN_INVITE_REDIRECT_URL");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const auth = await requireSuperAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    logFailure("request-json-failed", new Error("Invalid JSON body."));
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { adminClient, adminProfile } = auth;
  const action = String(body.action || "");
  logStage("action-resolved", { action });

  try {
    if (body.action === "list") {
      logStage("list-admins-start");

      const { data, error } = await adminClient
        .from("admin_users")
        .select(`
          id,
          auth_user_id,
          email,
          full_name,
          role,
          status,
          organization_id,
          photo_url,
          created_at,
          organizations (
            id,
            name
          )
        `)
        .order("id", { ascending: true });

      if (error) {
        logFailure("list-admins-failed", error);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }
      return jsonResponse({ data: (data || []).map(toSafeAdmin) });
    }

    if (body.action === "create" || body.action === "update") {
      logStage(body.action === "create" ? "create-user-start" : "update-user-start");

      const input = (body.admin || {}) as Record<string, unknown>;
      const payload = await validateAdminPayload(adminClient, input);

      if (body.action === "create") {
        const { data: inviteData, error: inviteError } =
          await adminClient.auth.admin.inviteUserByEmail(payload.email, {
            redirectTo: inviteRedirectTo || undefined,
          });

        if (inviteError || !inviteData.user?.id) {
          logFailure("create-user-failed", inviteError || new Error("Invite user response did not include a user."));
          return jsonResponse({ error: "Unable to send administrator account setup invite." }, 400);
        }

        const { data, error } = await adminClient
          .from("admin_users")
          .insert([{ ...payload, auth_user_id: inviteData.user.id }])
          .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
          .single();

        if (error) {
          logFailure("create-user-failed", error);
          await adminClient.auth.admin.deleteUser(inviteData.user.id);
          return jsonResponse({ error: sanitizeDbError(error) }, 400);
        }
        return jsonResponse({ data: toSafeAdmin(data) }, 201);
      }

      const targetId = Number(body.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        logFailure("update-user-failed", new Error("Administrator profile is required."));
        return jsonResponse({ error: "Administrator profile is required." }, 400);
      }

      const { data, error } = await adminClient
        .from("admin_users")
        .update(payload)
        .eq("id", targetId)
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
        .single();

      if (error) {
        logFailure("update-user-failed", error);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }
      return jsonResponse({ data: toSafeAdmin(data) });
    }

    if (body.action === "invite_existing_admin") {
      logStage("invite-existing-admin-start");

      const targetId = Number(body.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        logFailure("invite-existing-admin-failed", new Error("Administrator profile is required."));
        return jsonResponse({ error: "Administrator profile is required." }, 400);
      }

      const { data: target, error: targetError } = await adminClient
        .from("admin_users")
        .select(`
          id,
          auth_user_id,
          email,
          full_name,
          role,
          status,
          organization_id,
          photo_url,
          created_at,
          organizations (
            id,
            name
          )
        `)
        .eq("id", targetId)
        .maybeSingle();

      if (targetError) {
        logFailure("invite-existing-admin-failed", targetError);
        return jsonResponse({ error: sanitizeDbError(targetError) }, 400);
      }
      if (!target) return jsonResponse({ error: "Administrator profile was not found." }, 404);
      if (target.status !== "active") {
        return jsonResponse({ error: "Disabled administrator profiles cannot be invited." }, 403);
      }
      if (!roles.has(String(target.role))) {
        return jsonResponse({ error: "Administrator role is not supported for setup." }, 403);
      }

      const normalizedEmail = normalizeEmail(target.email);
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        logFailure("invite-existing-admin-failed", new Error("Administrator profile must have a valid email before setup."));
        return jsonResponse({ error: "Administrator profile must have a valid email before setup." }, 400);
      }

      if (target.auth_user_id) {
        return jsonResponse({ data: toSafeAdmin(target), already_linked: true });
      }

      const { user: existingAuthUser, error: listError } = await findAuthUserByEmail(adminClient, normalizedEmail);
      if (listError) {
        return jsonResponse({ error: "Unable to verify existing Auth identity." }, 500);
      }

      if (existingAuthUser?.id) {
        if (normalizeEmail(existingAuthUser.email) !== normalizedEmail) {
          return jsonResponse({ error: "Existing Auth identity email could not be verified." }, 409);
        }

        if (!hasConfirmedEmail(existingAuthUser as unknown as Record<string, unknown>)) {
          return jsonResponse({
            data: toSafeAdmin(target),
            email_verification_required: true,
            message: "Auth account exists, but email verification is incomplete. Complete verification or recovery before linking.",
          });
        }

        const { data: linkedElsewhere, error: linkCheckError } = await adminClient
          .from("admin_users")
          .select("id")
          .eq("auth_user_id", existingAuthUser.id)
          .maybeSingle();

        if (linkCheckError) return jsonResponse({ error: "Unable to verify Auth identity mapping." }, 500);
        if (linkedElsewhere && Number(linkedElsewhere.id) !== Number(target.id)) {
          return jsonResponse({ error: "That Auth identity is already linked to another administrator." }, 409);
        }

        const { data, error } = await adminClient
          .from("admin_users")
          .update({ auth_user_id: existingAuthUser.id })
          .eq("id", target.id)
          .is("auth_user_id", null)
          .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
          .single();

        if (error) {
          logFailure("invite-existing-admin-failed", error);
          return jsonResponse({ error: sanitizeDbError(error) }, 400);
        }
        return jsonResponse({
          data: toSafeAdmin(data),
          auth_user_already_existed: true,
          message: "Existing Auth identity linked. Use Supabase Auth recovery if this user needs a new password setup link.",
        });
      }

      const { data: inviteData, error: inviteError } =
        await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
          redirectTo: inviteRedirectTo || undefined,
        });

      if (inviteError || !inviteData.user?.id) {
        logFailure("invite-existing-admin-failed", inviteError || new Error("Invite user response did not include a user."));
        return jsonResponse({ error: "Unable to send administrator account setup invite." }, 400);
      }

      const { data, error } = await adminClient
        .from("admin_users")
        .update({ auth_user_id: inviteData.user.id })
        .eq("id", target.id)
        .is("auth_user_id", null)
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
        .single();

      if (error) {
        logFailure("invite-existing-admin-failed", error);
        await adminClient.auth.admin.deleteUser(inviteData.user.id);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }

      return jsonResponse({ data: toSafeAdmin(data), invite_sent: true });
    }

    if (body.action === "relink_existing_admin") {
      logStage("relink-existing-admin-start");

      const targetId = Number(body.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        logFailure("relink-existing-admin-failed", new Error("Administrator profile is required."));
        return jsonResponse({ error: "Administrator profile is required." }, 400);
      }

      const { data: target, error: targetError } = await adminClient
        .from("admin_users")
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
        .eq("id", targetId)
        .maybeSingle();

      if (targetError) {
        logFailure("relink-existing-admin-failed", targetError);
        return jsonResponse({ error: sanitizeDbError(targetError) }, 400);
      }

      if (!target) {
        return jsonResponse({ error: "Administrator profile was not found." }, 404);
      }

      if (target.status !== "active") {
        return jsonResponse({ error: "Disabled administrator profiles cannot be relinked." }, 403);
      }

      if (!roles.has(String(target.role))) {
        return jsonResponse({ error: "Administrator role is not supported for relinking." }, 403);
      }

      const normalizedEmail = normalizeEmail(target.email);
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        logFailure("relink-existing-admin-failed", new Error("Administrator profile must have a valid email before relinking."));
        return jsonResponse({ error: "Administrator profile must have a valid email before relinking." }, 400);
      }

      let currentAuthUser: Record<string, unknown> | null = null;
      if (target.auth_user_id) {
        const { data: currentAuthData, error: currentAuthError } =
          await adminClient.auth.admin.getUserById(String(target.auth_user_id));

        if (currentAuthError) {
          logFailure("relink-existing-admin-current-auth-lookup-failed", currentAuthError);
        } else {
          currentAuthUser = currentAuthData.user as unknown as Record<string, unknown>;
        }
      }

      const { users: matchingAuthUsers, error: matchError } =
        await findAuthUsersByEmail(adminClient, normalizedEmail);

      if (matchError) {
        logFailure("relink-existing-admin-failed", matchError);
        return jsonResponse({ error: "Unable to verify matching Auth identity." }, 500);
      }

      if (matchingAuthUsers.length === 0) {
        return jsonResponse({ error: "No confirmed Auth user matches this administrator email." }, 404);
      }

      if (matchingAuthUsers.length > 1) {
        return jsonResponse({ error: "More than one Auth user matches this administrator email." }, 409);
      }

      const matchingAuthUser = matchingAuthUsers[0];
      if (!hasConfirmedEmail(matchingAuthUser)) {
        return jsonResponse({ error: "Matching Auth user email is not confirmed." }, 403);
      }

      const matchingAuthUserId = String(matchingAuthUser.id || "");
      if (!matchingAuthUserId) {
        return jsonResponse({ error: "Matching Auth identity could not be verified." }, 409);
      }

      const { data: linkedElsewhere, error: linkCheckError } = await adminClient
        .from("admin_users")
        .select("id")
        .eq("auth_user_id", matchingAuthUserId)
        .maybeSingle();

      if (linkCheckError) {
        logFailure("relink-existing-admin-failed", linkCheckError);
        return jsonResponse({ error: "Unable to verify Auth identity mapping." }, 500);
      }

      if (linkedElsewhere && Number(linkedElsewhere.id) !== Number(target.id)) {
        return jsonResponse({ error: "That Auth identity is already linked to another administrator." }, 409);
      }

      if (matchingAuthUserId === String(target.auth_user_id || "")) {
        return jsonResponse({
          data: toSafeAdmin(target),
          already_correct: true,
          relinked: false,
          current_auth_email_matches: currentAuthUser
            ? normalizeEmail(currentAuthUser.email) === normalizedEmail
            : null,
        });
      }

      let relinkQuery = adminClient
        .from("admin_users")
        .update({ auth_user_id: matchingAuthUserId })
        .eq("id", target.id)
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)");

      relinkQuery = target.auth_user_id
        ? relinkQuery.eq("auth_user_id", target.auth_user_id)
        : relinkQuery.is("auth_user_id", null);

      const { data, error } = await relinkQuery.single();

      if (error) {
        logFailure("relink-existing-admin-failed", error);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }

      return jsonResponse({
        data: toSafeAdmin(data),
        already_correct: false,
        relinked: true,
      });
    }

    if (body.action === "disable" || body.action === "delete") {
      logStage("disable-user-start", { action: body.action });

      const targetId = Number(body.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        logFailure("disable-user-failed", new Error("Administrator profile is required."));
        return jsonResponse({ error: "Administrator profile is required." }, 400);
      }

      if (targetId === adminProfile.id) {
        logFailure("disable-user-failed", new Error("Super Admin attempted to disable own account."));
        return jsonResponse({ error: "You cannot disable your own Super Admin account." }, 400);
      }

      const { data, error } = await adminClient
        .from("admin_users")
        .update({ status: "disabled" })
        .eq("id", targetId)
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
        .single();

      if (error) {
        logFailure("disable-user-failed", error);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }
      return jsonResponse({ data: toSafeAdmin(data) });
    }

    if (body.action === "update_self_profile") {
      logStage("update-self-profile-start");

      const profile = (body.profile || {}) as Record<string, unknown>;
      const payload = {
        full_name: cleanText(profile.full_name),
        photo_url: cleanText(profile.photo_url || "", 2000) || null,
      };

      if (!payload.full_name) {
        logFailure("update-self-profile-failed", new Error("Full name is required."));
        return jsonResponse({ error: "Full name is required." }, 400);
      }

      const { data, error } = await adminClient
        .from("admin_users")
        .update(payload)
        .eq("id", adminProfile.id)
        .select("id, auth_user_id, email, full_name, role, status, organization_id, photo_url, created_at, organizations(id, name)")
        .single();

      if (error) {
        logFailure("update-self-profile-failed", error);
        return jsonResponse({ error: sanitizeDbError(error) }, 400);
      }
      return jsonResponse({ data: toSafeAdmin(data) });
    }
  } catch (error) {
    logFailure("action-failed", error instanceof Error ? error : new Error("The administrator request could not be completed."));
    return jsonResponse(
      { error: error instanceof Error ? error.message : "The administrator request could not be completed." },
      400,
    );
  }

  logFailure("unsupported-action", new Error("Unsupported administrator action."));
  return jsonResponse({ error: "Unsupported administrator action." }, 400);
});
