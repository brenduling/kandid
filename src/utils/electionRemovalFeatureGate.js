export function isElectionSoftRemovalEnabled() {
  return import.meta.env?.MODE === "development" || import.meta.env?.VITE_ENABLE_ELECTION_SOFT_REMOVAL === "true";
}
