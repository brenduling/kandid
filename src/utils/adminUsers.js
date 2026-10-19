import { supabase } from "../lib/supabaseClient";
import { isSupabaseAdminAuthMode } from "./auth";

const ADMIN_USER_MANAGEMENT_FUNCTION = "admin-user-management";
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
  return invokeAdminUserManagement("list");
}

export async function createAdminUser(payload) {
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
  return invokeAdminUserManagement("update", { id, admin: payload });
}

export async function disableAdminUser(id) {
  return invokeAdminUserManagement("disable", { id });
}

export async function deleteAdminUser(id) {
  return invokeAdminUserManagement("delete", { id });
}

export async function updateCurrentAdminProfile(payload) {
  return invokeAdminUserManagement("update_self_profile", { profile: payload });
}
