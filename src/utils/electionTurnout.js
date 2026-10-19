import { supabase } from "../lib/supabaseClient";

export async function loadElectionTurnout(electionId) {
  if (!electionId) return { data: null, error: null };
  try {
    return await supabase.rpc("kandid_get_election_turnout", {
      p_election_id: Number(electionId),
    });
  } catch (error) {
    return { data: null, error };
  }
}

export function formatTurnoutPercentage(summary) {
  const value = summary?.turnout_percentage;
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "Unavailable"
    : `${Number(value).toFixed(1)}%`;
}

export function turnoutMetricValue(summary, key) {
  const value = summary?.[key];
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "Unavailable"
    : Number(value).toLocaleString("en-PH");
}

export function turnoutAvailabilityLabel(summary) {
  const state = summary?.turnout_availability;
  if (state === "authoritative") return "Authoritative for this locked electorate";
  if (state === "zero_member_electorate") return "No eligible voters were present when locked";
  if (state === "legacy_unavailable") return "Legacy election; denominator unavailable";
  if (state === "mixed_ballot_and_legacy") return "Some legacy participation is not represented by ballot records";
  if (state === "electorate_unlocked") return "Electorate has not been locked";
  return "Turnout unavailable";
}
