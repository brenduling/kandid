import { supabase } from "../lib/supabaseClient";

export async function officersContract(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("officers-contract", {
    body: { action, ...payload },
  });

  if (error) {
    let message = data?.error;
    if (!message && error.context && typeof error.context.json === "function") {
      try {
        message = (await error.context.clone().json())?.error;
      } catch {
        // Keep the client-facing fallback below when the edge response is not JSON.
      }
    }
    message ||= error.message || "Officer request failed.";
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data?.data;
}
