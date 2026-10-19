export function hasDuplicateCandidateSelection(selections = []) {
  const seen = new Set();
  for (const selection of selections) {
    if (selection?.is_abstain || selection?.candidate_id == null) continue;
    const key = `${Number(selection.position_id)}:${Number(selection.candidate_id)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
