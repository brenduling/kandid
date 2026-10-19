import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boardStudentRegistrationFailureOutcome,
  boardStudentRegistrationOutcomeMessage,
  boardStudentRegistrationOutcomePresentation,
} from "../src/utils/boardStudentRegistrationMessages.js";

test("missing identity directs Board to Super Admin without opening a create flow", () => {
  const message = boardStudentRegistrationOutcomePresentation("STUDENT_IDENTITY_NOT_FOUND");
  assert.equal(message.heading, "Student record not found");
  assert.match(message.supporting, /Super Admin must add or import/i);
  assert.equal(boardStudentRegistrationOutcomeMessage("STUDENT_IDENTITY_NOT_FOUND", "fallback"), message.message);
});

test("enrollment, eligibility, and system membership outcomes are distinct", () => {
  assert.equal(boardStudentRegistrationOutcomePresentation("NOT_CURRENTLY_ENROLLED", "WITSG").heading, "Not currently enrolled");
  assert.equal(boardStudentRegistrationOutcomePresentation("NOT_CURRENTLY_ENROLLED", "WITSG").message.includes("WITSG"), true);
  assert.equal(boardStudentRegistrationOutcomePresentation("PROGRAM_NOT_ELIGIBLE_FOR_ORGANIZATION").heading, "Program not eligible");
  assert.equal(boardStudentRegistrationOutcomePresentation("ACTIVATION_SYNC_REQUIRED").heading, "Membership is system-managed");
});

test("invalid session and missing active Board authorization get different guidance", () => {
  assert.equal(boardStudentRegistrationOutcomePresentation("SESSION_INVALID").heading, "Sign-in required");
  assert.equal(boardStudentRegistrationOutcomePresentation("BOARD_AUTHORIZATION_REQUIRED").heading, "Board access needs attention");
  assert.equal(boardStudentRegistrationOutcomeMessage("UNKNOWN", "fallback"), "fallback");
});

test("a membership policy response remains distinct from HTTP authorization failures", () => {
  assert.equal(boardStudentRegistrationFailureOutcome({ outcome: "ACTIVATION_SYNC_REQUIRED" }, "activation_sync_required", 403), "ACTIVATION_SYNC_REQUIRED");
  assert.equal(boardStudentRegistrationFailureOutcome(null, "session_invalid", 401), "SESSION_INVALID");
  assert.equal(boardStudentRegistrationFailureOutcome(null, "board_forbidden", 403), "BOARD_AUTHORIZATION_REQUIRED");
});

test("already-active and previously-removed members resolve before the editable registration step", () => {
  const component = readFileSync("src/pages/board/BoardStudentRegistration.jsx", "utf8");
  assert.match(component, /function applyOutcome\(data\)[\s\S]*?data\?\.organization_outcome === "ALREADY_MEMBER"/);
  assert.match(component, /if \(applyOutcome\(data\)\) return;/);
});
