import {
  isMissingPositionOrderError,
  POSITION_BASE_SELECT,
} from "./positionOrder";

export async function copyLatestOrganizationPositions(
  supabase,
  { organizationId, targetElectionId },
) {
  if (!organizationId || !targetElectionId) {
    return { copiedCount: 0, sourceElection: null };
  }

  const existingTarget = await supabase
    .from("positions")
    .select("id", { count: "exact", head: true })
    .eq("election_id", targetElectionId);

  if (existingTarget.error) {
    return {
      copiedCount: 0,
      sourceElection: null,
      error: existingTarget.error,
    };
  }

  if ((existingTarget.count || 0) > 0) {
    return { copiedCount: 0, sourceElection: null };
  }

  const { data: previousElections, error: electionError } = await supabase
    .from("elections")
    .select("id, title")
    .eq("organization_id", organizationId)
    .neq("id", targetElectionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (electionError) {
    return { copiedCount: 0, sourceElection: null, error: electionError };
  }

  const sourceElection = previousElections?.[0];
  if (!sourceElection?.id) {
    return { copiedCount: 0, sourceElection: null };
  }

  let { data: sourcePositions, error: positionError } = await supabase
    .from("positions")
    .select(POSITION_BASE_SELECT)
    .eq("election_id", sourceElection.id)
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });

  if (isMissingPositionOrderError(positionError)) {
    const fallback = await supabase
      .from("positions")
      .select("id, name, election_id, max_votes")
      .eq("election_id", sourceElection.id)
      .order("id", { ascending: true });
    sourcePositions = fallback.data;
    positionError = fallback.error;
  }

  if (positionError) {
    return { copiedCount: 0, sourceElection, error: positionError };
  }

  const reusablePositions = sourcePositions || [];
  if (reusablePositions.length === 0) {
    return { copiedCount: 0, sourceElection };
  }

  const copiedRows = reusablePositions.map((position) => ({
      election_id: targetElectionId,
      name: position.name,
      max_votes: position.max_votes || 1,
      display_order: position.display_order,
    }));

  const { error: insertError } = await supabase.from("positions").insert(copiedRows);

  return {
    copiedCount: insertError ? 0 : copiedRows.length,
    sourceElection,
    error: insertError,
  };
}
