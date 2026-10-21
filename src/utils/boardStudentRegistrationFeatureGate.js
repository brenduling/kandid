const buildEnvironment = import.meta.env || {};

export function isBoardStudentRegistrationEnabled(environment = buildEnvironment) {
  return environment.MODE === "development" || environment.VITE_ENABLE_BOARD_STUDENT_REGISTRATION === "true";
}
