import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_RESULTS_ERROR_COPY,
  STUDENT_RESULTS_ERROR_KINDS,
  classifyStudentResultsError,
  studentAwaitingResultsCopy,
  studentResultsStatusMeta,
  studentZeroVoteCopy,
} from "../src/utils/studentResults.js";

function edgeError(status, body) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code.",
    context: {
      status,
      clone: () => ({ json: async () => body }),
    },
  };
}

const openElection = {
  title: "Sample Election",
  status: "active",
  student_result_visibility: "manual",
  results_released_at: null,
  start_date: "2026-10-15 09:00",
  end_date: "2026-10-16 17:00",
  organizations: { name: "Sample Organization" },
};
const closedElection = { ...openElection, status: "closed" };

test("Student result denials are classified as account-level, not raw backend errors", async () => {
  const raisedTurnoutDenial = {
    code: "42501",
    message: "Election is unavailable.",
    details: null,
    hint: null,
  };
  assert.equal(
    await classifyStudentResultsError(raisedTurnoutDenial),
    STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN,
  );

  const edgeResultsDenial = edgeError(403, {
    error: "Election results are unavailable.",
  });
  assert.equal(
    await classifyStudentResultsError(edgeResultsDenial),
    STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN,
  );

  const candidateDenial = {
    code: "42501",
    message: "Election results are unavailable.",
  };
  assert.equal(
    await classifyStudentResultsError(candidateDenial),
    STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN,
  );

  assert.equal(
    await classifyStudentResultsError(new Error("Authentication required.")),
    STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN,
  );
  assert.equal(
    await classifyStudentResultsError(edgeError(401, { message: "Unauthorized" })),
    STUDENT_RESULTS_ERROR_KINDS.FORBIDDEN,
  );
});

test("Deployment or schema gaps stay separate from student authorization denials", async () => {
  const missingFunction = {
    code: "PGRST202",
    message:
      "Could not find the function public.kandid_get_student_result_candidates(p_election_id) in the schema cache",
  };
  assert.equal(
    await classifyStudentResultsError(missingFunction),
    STUDENT_RESULTS_ERROR_KINDS.BACKEND,
  );

  const missingExecuteGrant = {
    code: "42501",
    message: "permission denied for function kandid_get_election_turnout",
  };
  assert.equal(
    await classifyStudentResultsError(missingExecuteGrant),
    STUDENT_RESULTS_ERROR_KINDS.BACKEND,
  );

  const edgeFunctionMissing = edgeError(404, {
    message: "Could not find the function vote-access",
  });
  assert.equal(
    await classifyStudentResultsError(edgeFunctionMissing),
    STUDENT_RESULTS_ERROR_KINDS.BACKEND,
  );

  const serviceFailure = edgeError(500, { message: "Internal error" });
  assert.equal(
    await classifyStudentResultsError(serviceFailure),
    STUDENT_RESULTS_ERROR_KINDS.BACKEND,
  );

  assert.equal(
    await classifyStudentResultsError(new Error("Position ordering contract failed")),
    STUDENT_RESULTS_ERROR_KINDS.BACKEND,
  );
});

test("Transport failures produce a distinct network state", async () => {
  assert.equal(
    await classifyStudentResultsError(new TypeError("Failed to fetch")),
    STUDENT_RESULTS_ERROR_KINDS.NETWORK,
  );

  const functionsFetchFailure = {
    name: "FunctionsFetchError",
    message: "Failed to send a request to the Edge Function",
  };
  assert.equal(
    await classifyStudentResultsError(functionsFetchFailure),
    STUDENT_RESULTS_ERROR_KINDS.NETWORK,
  );

  assert.equal(
    await classifyStudentResultsError(
      new Error("NetworkError when attempting to fetch resource."),
    ),
    STUDENT_RESULTS_ERROR_KINDS.NETWORK,
  );
});

test("Every error class carries distinct, sanitized student-facing copy", () => {
  const kinds = Object.values(STUDENT_RESULTS_ERROR_KINDS);
  const titles = kinds.map((kind) => STUDENT_RESULTS_ERROR_COPY[kind].title);
  assert.equal(new Set(titles).size, kinds.length);

  for (const kind of kinds) {
    const copy = STUDENT_RESULTS_ERROR_COPY[kind];
    assert.ok(copy.kicker && copy.body && copy.action);
    assert.doesNotMatch(
      `${copy.title} ${copy.body}`,
      /42501|PGRST|permission denied|Edge Function|vote-access|kandid_get_/i,
    );
  }
});

test("Unreleased elections always present the Awaiting Official Results state", () => {
  const manualOpen = studentAwaitingResultsCopy(openElection, new Date("2026-10-15T12:00:00+08:00"));
  assert.equal(manualOpen.title, "Awaiting Official Results");
  assert.match(manualOpen.body, /released by the election team after voting closes/i);

  const manualClosed = studentAwaitingResultsCopy(closedElection, new Date("2026-10-17T12:00:00+08:00"));
  assert.equal(manualClosed.title, "Awaiting Official Results");
  assert.match(manualClosed.body, /has not released the official results yet/i);

  const afterCloseOpen = studentAwaitingResultsCopy(
    { ...openElection, student_result_visibility: "after_close" },
    new Date("2026-10-15T12:00:00+08:00"),
  );
  assert.equal(afterCloseOpen.title, "Awaiting Official Results");
  assert.match(afterCloseOpen.body, /once voting closes/i);

  const realtimeBefore = studentAwaitingResultsCopy(
    { ...openElection, student_result_visibility: "realtime" },
    new Date("2026-10-14T12:00:00+08:00"),
  );
  assert.equal(realtimeBefore.title, "Awaiting Official Results");
  assert.match(realtimeBefore.body, /once voting opens/i);

  const archived = studentAwaitingResultsCopy(
    { ...openElection, status: "archived" },
    new Date("2026-10-20T12:00:00+08:00"),
  );
  assert.equal(archived.title, "Awaiting Official Results");
  assert.match(archived.body, /archived/i);
});

test("Awaiting state exposes schedule and status without revealing tallies", () => {
  const meta = studentResultsStatusMeta(closedElection, new Date("2026-10-17T12:00:00+08:00"));
  assert.match(meta, /Sample Organization/);
  assert.match(meta, /Manual release/);
  assert.match(meta, /Voting has closed/);
  assert.match(meta, /Voting .* – /);

  const winningCandidateName = "Sample Candidate";
  assert.doesNotMatch(meta, new RegExp(winningCandidateName, "i"));
  assert.doesNotMatch(meta, /\d+ vote/i);
});

test("Zero-vote tallies are distinguished from network and denial states", () => {
  const released = studentZeroVoteCopy({
    ...closedElection,
    results_released_at: "2026-10-17 09:00:00+00",
  });
  assert.equal(released.title, "No votes recorded");
  assert.match(released.body, /released these results/i);

  const pending = studentZeroVoteCopy({
    ...closedElection,
    student_result_visibility: "realtime",
  });
  assert.equal(pending.title, "No votes yet");
  assert.match(pending.body, /No ballots have been recorded/i);

  assert.notEqual(released.title, STUDENT_RESULTS_ERROR_COPY.network.title);
  assert.notEqual(pending.title, STUDENT_RESULTS_ERROR_COPY.forbidden.title);
});
