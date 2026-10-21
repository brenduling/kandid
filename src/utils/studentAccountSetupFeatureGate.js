const buildEnvironment = import.meta.env || {};

// Pre-auth OTP dispatch and identity linking remain opt-in while production
// Auth email delivery and the setup release are awaiting separate approval.
export function isStudentAccountSetupEnabled(environment = buildEnvironment) {
  return environment.VITE_ENABLE_STUDENT_ACCOUNT_SETUP === "true";
}

// Separate release gate: production v8 cannot supply the owner-approved limited
// pre-OTP recognition / post-OTP admission contract. Remains default-off.
export function isVerifiedStudentSetupEnabled(environment = buildEnvironment) {
  return isStudentAccountSetupEnabled(environment) && environment.VITE_ENABLE_VERIFIED_STUDENT_SETUP === "true";
}
