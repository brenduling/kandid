import { supabase } from "../lib/supabaseClient";

export async function callElectionRemoval(action, payload = {}) {
  if (!new Set(["review", "list_removed", "soft_remove", "restore"]).has(action)) {
    return { data: null, error: new Error("Election removal action is not supported.") };
  }
  try {
    const result = await supabase.functions.invoke("manage-election-removal", {
      body: { action, ...payload },
    });
    if (!result.error) return { data: result.data?.data ?? null, error: null };

    const status = Number(result.error?.context?.status || result.error?.status || 0);
    let responseBody = null;
    try {
      const context = result.error?.context;
      if (context && typeof context.clone === "function") responseBody = await context.clone().json();
      else if (context?.body && typeof context.body === "object") responseBody = context.body;
    } catch {
      // Keep the status-based fallback when the gateway body is not JSON.
    }
    return {
      data: null,
      error: {
        status,
        message: responseBody?.error || result.error?.message || "Election request failed.",
        context: { status, body: responseBody },
      },
    };
  } catch (error) {
    return { data: null, error };
  }
}

export function electionRemovalErrorMessage(error) {
  const contextStatus = Number(error?.context?.status || error?.status || 0);
  if (error?.context?.body?.code === "election_removal_not_enabled") return "Election removal and restoration are not activated.";
  if (contextStatus === 401) return error?.context?.body?.error || error?.message || "Your session or password could not be verified. Sign in again and retry.";
  if (contextStatus === 403) return "You do not have permission to change this election.";
  if (contextStatus === 409) return error?.context?.body?.error || "The election is active or its state changed. Review it again.";
  return error?.context?.body?.error || "The election change could not be confirmed. Refresh and retry.";
}
