const buildEnvironment = import.meta.env || {};

export function isBoardStudentManagementEnabled(environment = buildEnvironment) {
  return environment.VITE_ENABLE_BOARD_STUDENT_MANAGEMENT === "true";
}
