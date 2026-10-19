import { supabase } from "../src/lib/supabaseClient.js";
import { runBoardStudentManagementGateOffSmoke } from "../src/utils/boardStudentManagementSmoke.js";

export async function runBoardStudentManagementSmoke() {
  return runSmoke(false);
}

export async function runBoardStudentRegistrationReadinessSmoke() {
  return runSmoke(true);
}

async function runSmoke(registrationEnabled) {
  if (!import.meta.env.DEV || globalThis.location?.origin !== "http://localhost:5174") {
    throw new Error("Run this verification from the signed-in Board page at http://localhost:5174.");
  }
  return runBoardStudentManagementGateOffSmoke({
    client: supabase,
    url: import.meta.env.VITE_SUPABASE_URL,
    publicKey: import.meta.env.VITE_SUPABASE_KEY,
    registrationEnabled,
  });
}
