import { supabase } from "../lib/supabaseClient";
import {
  ORGANIZATION_DELETION_CONTRACT_ENABLED,
  normalizeDeletionReadiness,
  normalizeOrganizationDelete,
} from "./organizationDeletionState";

function validOrganizationId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getOrganizationDeletionReadiness(organizationId) {
  const id = validOrganizationId(organizationId);
  if (!id) {
    return { status: "error", data: null, error: new Error("A valid organization is required.") };
  }

  if (!ORGANIZATION_DELETION_CONTRACT_ENABLED) {
    return { status: "unavailable", data: null, error: null };
  }

  const { data, error } = await supabase.rpc("kandid_get_organization_deletion_readiness", {
    p_organization_id: id,
  });
  return normalizeDeletionReadiness(data, error);
}

export async function deleteOrganizationSafely(organizationId) {
  const id = validOrganizationId(organizationId);
  if (!id) {
    return { status: "error", data: null, error: new Error("A valid organization is required.") };
  }

  if (!ORGANIZATION_DELETION_CONTRACT_ENABLED) {
    return { status: "unavailable", data: null, error: null };
  }

  const { data, error } = await supabase.rpc("kandid_delete_organization", {
    p_organization_id: id,
  });
  return normalizeOrganizationDelete(data, error);
}
