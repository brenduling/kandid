import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStudentInTrustedEligibilityPool } from "../src/utils/candidateEligibility.js";

const positionsPage = readFileSync("src/pages/superadmin/Positions.jsx", "utf8");
const candidateManagement = readFileSync("src/components/CandidateManagement.jsx", "utf8");
const boardCandidates = readFileSync("src/pages/board/Candidates.jsx", "utf8");

test("trusted eligible response wins over a changed student profile program", () => {
  const trustedEligibleStudents = [{ id: 17, program: "BIO" }];
  const profileProgramAfterEdit = "BSIT";

  assert.notEqual(profileProgramAfterEdit, trustedEligibleStudents[0].program);
  assert.equal(isStudentInTrustedEligibilityPool(trustedEligibleStudents, 17), true);
});

test("manual-scope enrolled students need no program or coverage fields in the client", () => {
  const trustedManualMembership = [{ id: 23, current_membership: { source: "manual" } }];

  assert.equal(isStudentInTrustedEligibilityPool(trustedManualMembership, "23"), true);
});

test("institution eligibility does not depend on an organization name or alias", () => {
  const trustedInstitutionMembers = [{ id: 29 }];

  assert.equal(isStudentInTrustedEligibilityPool(trustedInstitutionMembers, 29), true);
});

test("a structural-only link cannot admit a student absent from trusted eligibility", () => {
  const trustedEligibleStudents = [{ id: 31 }];
  const structuralOnlyStudentId = 32;

  assert.equal(isStudentInTrustedEligibilityPool(trustedEligibleStudents, structuralOnlyStudentId), false);
});

test("a trusted eligible student remains eligible without a structural link", () => {
  const trustedEligibleStudents = [{ id: 37 }];

  assert.equal(isStudentInTrustedEligibilityPool(trustedEligibleStudents, 37), true);
});

test("Super Admin candidate selection and existing-candidate status use the trusted pool only", () => {
  assert.match(positionsPage, /loadCandidateManagementContext\(supabase, election\.id\)/);
  assert.match(positionsPage, /isStudentInTrustedEligibilityPool\(\s*eligibleStudents,\s*candidate\.student_id/s);
  assert.match(positionsPage, /isStudentInTrustedEligibilityPool\(\s*students,\s*candidate\.student_id/s);
  assert.match(positionsPage, /saveCandidateEdit\(supabase, editingCandidate, values, selectedPosition\.election_id\)/);
  assert.doesNotMatch(positionsPage, /isOrganizationEligibleForStudent|from\("student_organizations"\)/);
  assert.doesNotMatch(positionsPage, /organizationCoversStudentProgram|verifyOtherOrganizationCandidate/);
});

test("Board and shared candidate management continue to use trusted eligible students", () => {
  assert.match(boardCandidates, /<CandidateManagement\s+boardScoped/);
  assert.match(candidateManagement, /loadCandidateManagementContext\(supabase, selectedPosition\.election_id\)/);
  assert.match(candidateManagement, /students=\{studentsAvailableForCandidate\(\)\}/);
  assert.doesNotMatch(candidateManagement, /from\("student_organizations"\)|isOrganizationEligibleForStudent/);
});
