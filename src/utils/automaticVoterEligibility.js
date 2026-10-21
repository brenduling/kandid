// Release gate only. It never proves eligibility; all reads/submissions are
// authorized by the server. Leave disabled until the coordinated backend release.
export function isAutomaticVoterEligibilityEnabled(environment) {
  return environment?.VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY === "true";
}
