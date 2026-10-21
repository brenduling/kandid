import {createClient} from "@supabase/supabase-js";
import { recordSupabaseRequest, shouldProfileSupabase } from "../utils/supabaseProfiler";
import {
  isAllowedLocalProductionDashboardRequest,
  READ_ONLY_DASHBOARD_MODE,
} from "../utils/localProductionReadOnly";
import {
  fetchDevelopmentProductionRequest,
} from "../utils/developmentProductionWriteGuard";
import { isBoardStudentRegistrationEnabled } from "../utils/boardStudentRegistrationFeatureGate";
import { isBoardStudentManagementEnabled } from "../utils/boardStudentManagementFeatureGate";
import { isStudentAccountSetupEnabled } from "../utils/studentAccountSetupFeatureGate";
import { isElectionSoftRemovalEnabled } from "../utils/electionRemovalFeatureGate";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

export const guardedSupabaseFetch = async (input, init) => {
  let localRole;
  if (typeof window !== "undefined") {
    try {
      localRole = JSON.parse(window.localStorage.getItem("user") || "null")?.role;
    } catch {
      localRole = undefined;
    }
  }
  if (
    import.meta.env.MODE === READ_ONLY_DASHBOARD_MODE &&
    !isAllowedLocalProductionDashboardRequest({
      input,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      body: init?.body ?? (input instanceof Request ? input.body : null),
      role: localRole,
    })
  ) {
    throw new Error("Blocked by the local production read-only dashboard test mode.");
  }
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const response = import.meta.env.MODE === "development"
    ? await fetchDevelopmentProductionRequest(input, init, globalThis.fetch, {
      allowBackendAuthorizedAdminCrud: true,
      allowElection4Recovery: import.meta.env.VITE_ENABLE_ELECTION_4_RECOVERY === "true",
      allowBoardStudentRegistration: isBoardStudentRegistrationEnabled(),
      allowBoardStudentManagement: isBoardStudentManagementEnabled(),
      allowStudentAccountSetup: isStudentAccountSetupEnabled(),
      allowElectionSoftRemoval: isElectionSoftRemovalEnabled(),
      allowElectionManagement: import.meta.env.VITE_ENABLE_ELECTION_MANAGEMENT === "true",
      allowPositionManagement: import.meta.env.VITE_ENABLE_POSITION_MANAGEMENT === "true",
      allowCandidateManagement: import.meta.env.VITE_ENABLE_CANDIDATE_MANAGEMENT === "true",
      allowIsolatedStudentSetupTests: import.meta.env.VITE_ENABLE_ISOLATED_STUDENT_SETUP_TESTS === "true",
    })
    : await fetch(input, init);

  if (shouldProfileSupabase()) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordSupabaseRequest(input, init, response, endedAt - startedAt);
  }

  return response;
};

// Vite can reevaluate this module without replacing the browser context. Reuse
// its Auth client so the same persisted session has only one owner during HMR.
const cachedClient = import.meta.hot?.data.kandidSupabaseClient;
const clientState = cachedClient && cachedClient.url === supabaseUrl && cachedClient.key === supabaseAnonKey
  ? cachedClient
  : { url: supabaseUrl, key: supabaseAnonKey };

// The reused client's transport must still pick up changes to the read/write
// guard rather than retaining the first module evaluation's fetch closure.
clientState.fetch = guardedSupabaseFetch;
clientState.client ??= createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => clientState.fetch(input, init),
  },
});

export const supabase = clientState.client;

if (import.meta.hot) {
  import.meta.hot.data.kandidSupabaseClient = clientState;
}
