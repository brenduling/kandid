import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  boardCanAccessOrganization,
  boardCanAccessStudentMembership,
  isActiveAdminForAuthUser,
  isActiveStudentForAuthUser,
  projectOwnStudentReceipt,
} from "../supabase/functions/_shared/voteAccessContracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Student access is bound to the active profile mapped to the verified Auth identity", () => {
  const student = { id: 7, auth_user_id: "auth-student-7", status: "active" };
  assert.equal(isActiveStudentForAuthUser(student, "auth-student-7"), true);
  assert.equal(isActiveStudentForAuthUser(student, "auth-student-8"), false);
  assert.equal(isActiveStudentForAuthUser({ ...student, status: "inactive" }, "auth-student-7"), false);
});

test("admin actions require an active mapped administrator and the requested role", () => {
  const admin = { auth_user_id: "auth-admin-1", role: "super_admin", status: "active" };
  assert.equal(isActiveAdminForAuthUser(admin, "auth-admin-1", "super_admin"), true);
  assert.equal(isActiveAdminForAuthUser(admin, "auth-admin-1", "electoral_board"), false);
  assert.equal(isActiveAdminForAuthUser({ ...admin, status: "inactive" }, "auth-admin-1"), false);
  assert.equal(isActiveAdminForAuthUser({ ...admin, auth_user_id: "other-auth" }, "auth-admin-1"), false);
});

test("Board access is scoped to its organization and a Student membership in that organization", () => {
  const board = { role: "electoral_board", organization_id: 31 };
  assert.equal(boardCanAccessOrganization(board, 31), true);
  assert.equal(boardCanAccessOrganization(board, 32), false);
  assert.equal(boardCanAccessStudentMembership(board, 31, true), true);
  assert.equal(boardCanAccessStudentMembership(board, 31, false), false);
  assert.equal(boardCanAccessStudentMembership(board, 32, true), false);
});

test("Student receipt projection strips candidate and Student mapping fields", () => {
  const receipt = projectOwnStudentReceipt({
    id: 5,
    election_id: 9,
    position_id: 3,
    is_abstain: false,
    vote_hash: "0xreceipt",
    student_id: 44,
    candidate_id: 88,
    elections: { title: "Synthetic", organization_id: 31, organizations: { name: "Org", id: 31 } },
    positions: { id: 3, name: "Chair", display_order: 1 },
  });
  assert.equal(receipt.id, 5);
  assert.equal(receipt.positions.name, "Chair");
  assert.equal("student_id" in receipt, false);
  assert.equal("candidate_id" in receipt, false);
  assert.equal("organization_id" in receipt.elections, false);
  assert.equal("id" in receipt.elections.organizations, false);
});

test("Edge handlers use the shared identity, role, and organization guards", async () => {
  const source = await readFile(path.join(root, "supabase/functions/vote-access/index.ts"), "utf8");
  assert.match(source, /authClient\.auth\.getUser\(\)/);
  assert.match(source, /isActiveStudentForAuthUser\(student, authId\)/);
  assert.match(source, /isActiveAdminForAuthUser\(profile, authId, role\)/);
  assert.match(source, /boardCanAccessOrganization\(profile, election\.organization_id\)/);
  assert.match(source, /boardCanAccessStudentMembership\(profile, organizationId, Number\(membershipCount \|\| 0\) > 0\)/);
  assert.match(source, /votes\.map\(projectOwnStudentReceipt\)/);
});
