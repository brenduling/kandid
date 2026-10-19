import { supabase } from "../lib/supabaseClient";

/** All browser vote data is returned through role-scoped trusted operations. */
export async function callVoteAccess(action, payload = {}, client = supabase) {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.access_token) {
    return { data: null, error: sessionError || new Error("Authentication required.") };
  }

  const { data, error } = await client.functions.invoke("vote-access", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: { action, ...payload },
  });

  return { data: data?.data ?? null, error };
}

export async function verifyStudentElectionAccessCode({ electionId, token, accessToken, client = supabase }) {
  let resolvedAccessToken = accessToken;
  if (!resolvedAccessToken) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    resolvedAccessToken = sessionData?.session?.access_token;
    if (sessionError || !resolvedAccessToken) {
      return { data: null, error: sessionError || new Error("Authentication required.") };
    }
  }

  const { data, error } = await client.functions.invoke("vote-access", {
    headers: { Authorization: `Bearer ${resolvedAccessToken}` },
    body: {
      action: "student_verify_access_code",
      election_id: Number(electionId),
      token: String(token || "").trim().toUpperCase(),
    },
  });
  return { data: data?.data ?? null, error };
}

export async function verifyStudentElectionGeofence({ electionId, coordinates, accessToken, client = supabase }) {
  let resolvedAccessToken = accessToken;
  if (!resolvedAccessToken) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    resolvedAccessToken = sessionData?.session?.access_token;
    if (sessionError || !resolvedAccessToken) {
      return { data: null, error: sessionError || new Error("Authentication required.") };
    }
  }
  const { data, error } = await client.functions.invoke("vote-access", {
    headers: { Authorization: `Bearer ${resolvedAccessToken}` },
    body: {
      action: "student_verify_geofence",
      election_id: Number(electionId),
      coordinates,
    },
  });
  return { data: data?.data ?? null, error };
}

export async function getStudentVotedElectionIds() {
  const { data, error } = await callVoteAccess("student_voted_elections");
  return { data: data?.election_ids || [], error };
}

export async function getVoteDependencyCount(entityType, entityId, context = {}) {
  const { data, error } = await callVoteAccess("vote_dependency_count", {
    entity_type: entityType,
    entity_id: Number(entityId),
    ...context,
  });
  return { count: Number(data?.count || 0), error };
}
