// Presentation of the existing transport restriction, never an authorization
// decision. Auth, RLS, lifecycle triggers and the fetch guard remain authoritative.
export function electionEditBlockReason(env) {
  if (env.MODE === "localhost-production-readonly") {
    return "This preview is read-only. Election changes cannot be saved.";
  }
  // Normal development now uses the same backend authorization as the deployed
  // application. Only the explicit inspection mode is read-only.
  return "";
}
