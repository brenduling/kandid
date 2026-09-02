export const POSITION_ORDER_SELECT = "id, name, election_id, max_votes";
export const POSITION_BASE_SELECT = "id, name, election_id, max_votes";

export function isMissingPositionOrderError(error) {
  const message = error?.message || "";
  return /display_order|schema cache|column .*does not exist/i.test(message);
}

export function normalizePositionOrder(position, index = 0) {
  const explicitOrder = Number(position?.display_order);
  return Number.isFinite(explicitOrder) && explicitOrder > 0
    ? explicitOrder
    : index + 1;
}

export function sortPositions(positions = []) {
  return [...positions].sort((a, b) => {
    const orderDelta =
      normalizePositionOrder(a) - normalizePositionOrder(b);
    if (orderDelta !== 0) return orderDelta;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });
}

export function positionOrderValue(position) {
  return normalizePositionOrder(position);
}

export async function fetchOrderedPositions(supabase, electionId) {
  let query = supabase
    .from("positions")
    .select(POSITION_ORDER_SELECT)
    .order("id", { ascending: true });

  if (electionId !== undefined && electionId !== null && electionId !== "") {
    query = query.eq("election_id", electionId);
  }

  let { data, error } = await query;

  return {
    data: (data || []).map((position, index) => ({
      ...position,
      display_order: index + 1,
    })),
    error,
  };
}

export function sortVotesByPositionOrder(votes = []) {
  return [...votes].sort((a, b) => {
    const aOrder = normalizePositionOrder(a.positions);
    const bOrder = normalizePositionOrder(b.positions);
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (Number(a.position_id || 0) !== Number(b.position_id || 0)) {
      return Number(a.position_id || 0) - Number(b.position_id || 0);
    }
    return Number(a.id || 0) - Number(b.id || 0);
  });
}
