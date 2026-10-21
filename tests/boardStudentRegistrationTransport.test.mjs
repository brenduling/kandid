import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FunctionsClient } from "@supabase/functions-js";
import {
  boardStudentRegistrationFailureOutcome,
  boardStudentRegistrationOutcomePresentation,
} from "../src/utils/boardStudentRegistrationMessages.js";

// Run the existing request utility through the installed Supabase SDK. Every
// transport is synthetic; this suite cannot contact Supabase or create records.
function fixture(customFetch) {
  const calls = [];
  const functions = new FunctionsClient("https://synthetic.invalid/functions/v1", {
    customFetch: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      return customFetch();
    },
  });
  const source = readFileSync("src/utils/boardManualEnrollment.js", "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const helpers = new Function("supabase", "isBoardStudentRegistrationEnabled", "isBoardStudentManagementEnabled", `${source}\nreturn { registerNewBoardStudentForTerm, registerExistingBoardStudentForTerm, resolveBoardStudentForTerm };`)(
    { functions }, () => true, () => false,
  );
  return { calls, helpers };
}

const student = {
  student_number: "12345", first_name: "Synthetic", last_name: "Student",
  program: "BSIT", year_level: 1,
};
const verification = { method: "school_id", evidenceReviewed: true };
const outcome = (result) => boardStudentRegistrationFailureOutcome(
  result.data, result.code, result.status, result.error,
);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", ...headers },
});
const interruptedBody = (status = 200) => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('{"data":'));
  },
  pull(controller) {
    controller.error(new TypeError("Synthetic response body connection closed"));
  },
}), { status, headers: { "Content-Type": "application/json" } });

for (const committedBeforeDisconnect of [false, true]) {
  test(`closed connection has an unconfirmed result without retry (synthetic commit=${committedBeforeDisconnect})`, async () => {
    let syntheticCommits = 0;
    const { calls, helpers } = fixture(() => {
      if (committedBeforeDisconnect) syntheticCommits += 1;
      throw new TypeError("Failed to fetch: net::ERR_CONNECTION_CLOSED");
    });
    const result = await helpers.registerNewBoardStudentForTerm(student, verification);
    assert.equal(result.error.name, "FunctionsFetchError");
    assert.equal(result.status, null);
    assert.equal(outcome(result), "REGISTRATION_RESULT_UNKNOWN");
    assert.equal(syntheticCommits, Number(committedBeforeDisconnect));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.action, "create_new_student_for_term");
    assert.equal(calls[0].body.evidence_reviewed, true);
    const feedback = boardStudentRegistrationOutcomePresentation(outcome(result));
    assert.match(feedback.message, /couldn't confirm whether.*saved/);
    assert.match(feedback.supporting, /Check the student list and current-term enrollment before submitting again/);
    assert.doesNotMatch(feedback.message, /Check the student record|try again/i);
  });
}

for (const method of ["registerNewBoardStudentForTerm", "registerExistingBoardStudentForTerm"]) {
  for (const committedBeforeDisconnect of [false, true]) {
    test(`${method}: interrupted response body is unconfirmed without retry (synthetic commit=${committedBeforeDisconnect})`, async () => {
      let syntheticCommits = 0;
      const { calls, helpers } = fixture(() => {
        if (committedBeforeDisconnect) syntheticCommits += 1;
        return interruptedBody();
      });
      const result = await helpers[method](student, verification);
      assert.equal(result.error.name, "TypeError");
      assert.equal(result.status, null);
      assert.equal(result.data, null);
      assert.equal(outcome(result), "REGISTRATION_RESULT_UNKNOWN");
      assert.equal(syntheticCommits, Number(committedBeforeDisconnect));
      assert.equal(calls.length, 1);
      const feedback = boardStudentRegistrationOutcomePresentation(outcome(result));
      assert.match(feedback.supporting, /before submitting again/);
    });
  }
}

test("a relay failure also leaves registration unconfirmed without retry", async () => {
  const { calls, helpers } = fixture(() => json({ error: "Relay unavailable." }, 502, { "x-relay-error": "true" }));
  const result = await helpers.registerExistingBoardStudentForTerm(student, verification);
  assert.equal(result.error.name, "FunctionsRelayError");
  assert.equal(outcome(result), "REGISTRATION_RESULT_UNKNOWN");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, "enroll_existing_student_for_term");
});

test("explicit session and Board authorization rejections retain specific guidance", async () => {
  for (const [status, code, expected] of [
    [401, "session_invalid", "SESSION_INVALID"],
    [403, "board_forbidden", "BOARD_AUTHORIZATION_REQUIRED"],
  ]) {
    const { calls, helpers } = fixture(() => json({ error: "Rejected.", code }, status));
    const result = await helpers.registerExistingBoardStudentForTerm(student, verification);
    assert.equal(result.error.name, "FunctionsHttpError");
    assert.equal(outcome(result), expected);
    assert.equal(calls.length, 1);
  }
});

test("a known server eligibility outcome is preserved through the SDK HTTP error", async () => {
  const { helpers } = fixture(() => json({ data: { outcome: "INELIGIBLE" }, code: "ineligible" }, 403));
  const result = await helpers.registerExistingBoardStudentForTerm(student, verification);
  assert.equal(outcome(result), "INELIGIBLE");
});

test("explicit HTTP rejection remains authoritative even when its body is interrupted", async () => {
  for (const [status, expected] of [
    [401, "SESSION_INVALID"], [403, "BOARD_AUTHORIZATION_REQUIRED"], [422, null],
  ]) {
    const { calls, helpers } = fixture(() => interruptedBody(status));
    const result = await helpers.registerNewBoardStudentForTerm(student, verification);
    assert.equal(result.error.name, "FunctionsHttpError");
    assert.equal(result.status, status);
    assert.equal(outcome(result), expected);
    assert.equal(calls.length, 1);
  }
});

test("a plain TypeError cannot override known server outcomes, codes, or statuses", () => {
  const error = new TypeError("Synthetic body interruption");
  for (const [data, code, status, expected] of [
    [{ outcome: "INELIGIBLE" }, "ineligible", 403, "INELIGIBLE"],
    [null, "session_invalid", null, "SESSION_INVALID"],
    [null, "board_forbidden", null, "BOARD_AUTHORIZATION_REQUIRED"],
    [null, null, 401, "SESSION_INVALID"],
    [null, null, 403, "BOARD_AUTHORIZATION_REQUIRED"],
    [null, "invalid_student_record", null, null],
    [null, null, 422, null],
    [{ validation: "rejected" }, null, null, null],
  ]) {
    assert.equal(boardStudentRegistrationFailureOutcome(data, code, status, error), expected);
  }
});

test("successful registration retains the trusted result and makes one request", async () => {
  for (const successOutcome of [
    "NEW_STUDENT_CREATED", "EXISTING_STUDENT_ENROLLED",
    "EXISTING_STUDENT_TERM_RESTORED", "EXISTING_STUDENT_ORGANIZATION_REGISTERED",
  ]) {
    const data = { outcome: successOutcome, organization_outcome: "REGISTERED" };
    const { calls, helpers } = fixture(() => json({ data }));
    const method = successOutcome === "NEW_STUDENT_CREATED"
      ? "registerNewBoardStudentForTerm" : "registerExistingBoardStudentForTerm";
    const result = await helpers[method](student, verification);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, data);
    assert.equal(calls.length, 1);
  }
});

test("read-only Student ID lookup keeps its separate read-failure handling", async () => {
  const { calls, helpers } = fixture(() => { throw new TypeError("Synthetic offline lookup"); });
  const result = await helpers.resolveBoardStudentForTerm(student.student_number);
  assert.equal(boardStudentRegistrationFailureOutcome(result.data, result.code, result.status), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, "resolve_student_for_term");
});
