import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasCurrentTermEnrollment } from "../supabase/functions/_shared/currentTermEnrollment.js";

const submitVote = readFileSync("supabase/functions/submit-vote/index.ts", "utf8");
const submissionMigration = readFileSync(
  "supabase/migrations/20260913155000_create_ballot_v1_submission_rpc.sql",
  "utf8",
);

const studentId = 71001;
const activeTermId = 202602;
const enrolledRow = {
  student_id: studentId,
  academic_term_id: activeTermId,
  enrollment_status: "enrolled",
};

test("currently enrolled Student who is frozen-eligible passes the current-term check", () => {
  assert.equal(hasCurrentTermEnrollment({
    studentId,
    activeTermId,
    electionTermId: activeTermId,
    enrollmentRows: [enrolledRow],
  }), true);
});

test("previously frozen-eligible Student without current enrollment is denied", () => {
  assert.equal(hasCurrentTermEnrollment({
    studentId,
    activeTermId,
    electionTermId: activeTermId,
    enrollmentRows: [],
  }), false);
  assert.equal(hasCurrentTermEnrollment({
    studentId,
    activeTermId,
    electionTermId: activeTermId,
    enrollmentRows: [{ ...enrolledRow, enrollment_status: "withdrawn" }],
  }), false);
});

test("enrollment in a different academic term does not satisfy current-term eligibility", () => {
  assert.equal(hasCurrentTermEnrollment({
    studentId,
    activeTermId,
    electionTermId: activeTermId,
    enrollmentRows: [{ ...enrolledRow, academic_term_id: activeTermId - 1 }],
  }), false);
  assert.equal(hasCurrentTermEnrollment({
    studentId,
    activeTermId: activeTermId + 1,
    electionTermId: activeTermId,
    enrollmentRows: [enrolledRow],
  }), false);
});

test("frozen-policy submissions verify current enrollment before the frozen roster", () => {
  const frozenBranch = submitVote.slice(
    submitVote.indexOf('if (Number(election.electorate_policy_version) === 1)'),
    submitVote.indexOf('} else if (Number(election.electorate_policy_version) === 0)'),
  );
  assert.match(frozenBranch, /\.from\("academic_terms"\)[\s\S]*?\.eq\("status", "active"\)/);
  assert.match(frozenBranch, /\.from\("student_term_enrollments"\)[\s\S]*?\.eq\("enrollment_status", "enrolled"\)/);
  assert.match(frozenBranch, /hasCurrentTermEnrollment\([\s\S]*?electionTermId:[\s\S]*?\)[\s\S]*?kandid_is_locked_electorate_member/);
});

test("the existing trusted submission RPC still rejects a duplicate student/election ballot", () => {
  assert.match(submissionMigration, /pg_advisory_xact_lock\([\s\S]*?student_id[\s\S]*?election_id/i);
  assert.match(submissionMigration, /if exists\s*\([\s\S]*?public\.votes[\s\S]*?student_id[\s\S]*?election_id[\s\S]*?already voted in this election/i);
  assert.match(submitVote, /adminClient\.rpc\([\s\S]*?"insert_v2_vote_rows"/);
});
