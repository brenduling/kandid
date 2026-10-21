const buildEnvironment = import.meta.env || {};

export function isBoardStudentManagementEnabled(environment = buildEnvironment) {
  return environment.MODE === "development" || environment.VITE_ENABLE_BOARD_STUDENT_MANAGEMENT === "true";
}
