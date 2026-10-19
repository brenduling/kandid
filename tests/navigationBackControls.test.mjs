import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authenticated Board and Super Admin shells rely on persistent navigation", async () => {
  const [boardLayout, superAdminLayout] = await Promise.all([
    read("src/layouts/BoardLayout.jsx"),
    read("src/layouts/SuperAdminLayout.jsx"),
  ]);

  for (const [name, source] of [["Board", boardLayout], ["Super Admin", superAdminLayout]]) {
    assert.match(source, /<Outlet\s*\/>/, `${name} shell still renders its routed workspace`);
    assert.match(source, /<MobileNav/, `${name} mobile navigation remains available`);
    assert.doesNotMatch(source, /app-page-back-button|navigate\s*\(\s*-1|history\.back/);
    assert.doesNotMatch(source, /ArrowLeft/);
  }
});

test("contextual form, election, authentication, student, and kiosk navigation remains", async () => {
  const paths = [
    "src/pages/board/BoardElectionSetup.jsx",
    "src/pages/board/BoardStudentRegistration.jsx",
    "src/pages/board/EligibilityRules.jsx",
    "src/pages/board/OfficerFormDialog.jsx",
    "src/pages/board/Partylists.jsx",
    "src/pages/board/Reports.jsx",
    "src/pages/superadmin/Positions.jsx",
    "src/pages/superadmin/Students.jsx",
    "src/pages/superadmin/MasterlistReview.jsx",
    "src/components/AuthLayout.jsx",
    "src/pages/student/Campaign.jsx",
    "src/pages/student/VotePage.jsx",
    "src/pages/student/ReceiptDetails.jsx",
    "src/pages/student/BallotVerification.jsx",
    "src/components/student/StudentOrganizationDetail.jsx",
    "src/pages/shared/KioskVoting.jsx",
  ];
  const sources = await Promise.all(paths.map(read));

  for (const path of paths) {
    const source = sources[paths.indexOf(path)];
    assert.match(source, /Back|Return to|Change election|ArrowLeft|onBack/, `${path} keeps its contextual return path`);
  }
});
