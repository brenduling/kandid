import { supabase } from "../lib/supabaseClient";
import { isSupabaseAdminAuthMode } from "./auth";

const ADMIN_USER_MANAGEMENT_FUNCTION = "admin-user-management";
const ADMIN_USER_SELECT = `
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
`;

function toSafeAdmin(user) {
  const safeUser = { ...(user || {}) };
  delete safeUser.password;
  delete safeUser.auth_user_id;
  return {
    ...safeUser,
    auth_linked: Boolean(user?.auth_user_id),
  };
}

async function invokeAdminUserManagement(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(ADMIN_USER_MANAGEMENT_FUNCTION, {
    body: { action, ...payload },
  });

  let resolvedError = error || null;
  if (error?.context?.json) {
    try {
      const errorPayload = await error.context.clone().json();
      resolvedError = new Error(errorPayload?.error || error.message);
    } catch {
      resolvedError = error;
    }
  }

  return { data: data?.data ?? null, error: resolvedError, meta: data || null };
}

export async function listAdminUsers() {
  if (!isSupabaseAdminAuthMode()) {
    const { data, error } = await supabase
      .from("admin_users")
      .select(ADMIN_USER_SELECT)
      .order("id", { ascending: true });

    return { data: (data || []).map(toSafeAdmin), error };
  }

  return invokeAdminUserManagement("list");
}

export async function createAdminUser(payload) {
  if (!isSupabaseAdminAuthMode()) {
    const { data, error } = await supabase
      .from("admin_users")
      .insert([{ ...payload, password: payload.password || "" }])
      .select(ADMIN_USER_SELECT)
      .single();

    return { data: data ? toSafeAdmin(data) : null, error };
  }

  return invokeAdminUserManagement("create", { admin: payload });
}

export async function inviteExistingAdminUser(id) {
  if (!isSupabaseAdminAuthMode()) {
    return {
      data: null,
      error: new Error("Secure Auth invites are available only in Supabase admin auth mode."),
    };
  }

  return invokeAdminUserManagement("invite_existing_admin", { id });
}

export async function relinkExistingAdminUser(id) {
  if (!isSupabaseAdminAuthMode()) {
    return {
      data: null,
      error: new Error("Secure Auth relinking is available only in Supabase admin auth mode."),
    };
  }

  return invokeAdminUserManagement("relink_existing_admin", { id });
}

export async function updateAdminUser(id, payload) {
  if (!isSupabaseAdminAuthMode()) {
    const { data, error } = await supabase
      .from("admin_users")
      .update(payload)
      .eq("id", id)
      .select(ADMIN_USER_SELECT)
      .single();

    return { data: data ? toSafeAdmin(data) : null, error };
  }

  return invokeAdminUserManagement("update", { id, admin: payload });
}

export async function disableAdminUser(id) {
  if (!isSupabaseAdminAuthMode()) {
    const { data, error } = await supabase
      .from("admin_users")
      .update({ status: "disabled" })
      .eq("id", id)
      .select(ADMIN_USER_SELECT)
      .single();

    return { data: data ? toSafeAdmin(data) : null, error };
  }

  return invokeAdminUserManagement("disable", { id });
}

export async function deleteAdminUser(id) {
  if (!isSupabaseAdminAuthMode()) {
    return disableAdminUser(id);
  }

  return invokeAdminUserManagement("delete", { id });
}

export async function updateCurrentAdminProfile(payload) {
  return invokeAdminUserManagement("update_self_profile", { profile: payload });
}
