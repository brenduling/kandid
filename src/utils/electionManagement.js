import { supabase } from "../lib/supabaseClient";

// Explicit browser projection. Geofence coordinates are loaded separately by
// the role-checked RPC only when an authorized administrator edits an election.
export { ELECTION_MANAGEMENT_SELECT } from "./electionManagementCompatibility.js";

export async function fetchElectionGeofenceForAdmin(electionId) {
  return supabase.rpc("kandid_get_admin_election_geofence", {
    p_election_id: Number(electionId),
  });
}
