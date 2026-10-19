// Flip only after the trusted deletion migration is applied to the target
// backend. Keeping this false prevents the existing UI from calling pending RPCs.
export const ORGANIZATION_DELETION_CONTRACT_ENABLED = false;

function isMissingRpcError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code === "PGRST202" || code === "42883") return true;

  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /could not find the function/.test(details) ||
    /function .* does not exist/.test(details) ||
    /schema cache.*function/.test(details)
  );
}

function fromRpcError(error) {
  return {
    status: isMissingRpcError(error) ? "unavailable" : "error",
    data: null,
    error,
  };
}

export function normalizeDeletionReadiness(data, error = null) {
  if (error) return fromRpcError(error);
  if (!data || typeof data.can_delete !== "boolean") {
    return { status: "error", data: null, error: null };
  }

  const hasUnknownDependency = Array.isArray(data.dependencies)
    && data.dependencies.some((dependency) => dependency?.count == null);
  if (data.verification_required === true || hasUnknownDependency) {
    return { status: "verification_required", data, error: null };
  }

  return {
    status: data.can_delete ? "ready" : "blocked",
    data,
    error: null,
  };
}

export function normalizeOrganizationDelete(data, error = null) {
  if (error) return fromRpcError(error);
  if (data?.deleted === true) {
    return { status: "deleted", data, error: null };
  }
  if (data?.deleted === false && data.readiness?.can_delete === false) {
    if (data.readiness.verification_required === true
      || data.readiness.dependencies?.some((dependency) => dependency?.count == null)) {
      return { status: "verification_required", data: data.readiness, error: null };
    }
    return { status: "blocked", data: data.readiness, error: null };
  }

  return { status: "error", data: null, error: null };
}
