export const POSITION_ORDER_SELECT = "id, name, election_id, max_votes, display_order";
export const POSITION_BASE_SELECT = "id, name, election_id, max_votes, display_order";

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
  const buildOrderedQuery = () => {
    let query = supabase
      .from("positions")
      .select(POSITION_ORDER_SELECT)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true });

    if (electionId !== undefined && electionId !== null && electionId !== "") {
      query = query.eq("election_id", electionId);
    }

    return query;
  };

  const buildLegacyQuery = () => {
    let query = supabase
      .from("positions")
      .select("id, name, election_id, max_votes")
      .order("id", { ascending: true });

    if (electionId !== undefined && electionId !== null && electionId !== "") {
      query = query.eq("election_id", electionId);
    }

    return query;
  };

  let { data, error } = await buildOrderedQuery();

  if (isMissingPositionOrderError(error)) {
    const fallback = await buildLegacyQuery();
    data = fallback.data;
    error = fallback.error;
  }

  return {
    data: sortPositions(data || []).map((position, index) => ({
      ...position,
      display_order: normalizePositionOrder(position, index),
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
