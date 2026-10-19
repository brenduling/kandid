const buildEnvironment = import.meta.env || {};

// Pre-auth OTP dispatch and identity linking remain opt-in while production
// Auth email delivery and the setup release are awaiting separate approval.
export function isStudentAccountSetupEnabled(environment = buildEnvironment) {
  return environment.VITE_ENABLE_STUDENT_ACCOUNT_SETUP === "true";
}
