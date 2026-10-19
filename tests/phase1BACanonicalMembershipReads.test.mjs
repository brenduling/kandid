import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const access = read("src/utils/organizationAccess.js");
const superAdminStudents = read("src/pages/superadmin/Students.jsx");
const superAdminOrganizations = read("src/pages/superadmin/Organizations.jsx");
const profile = read("src/utils/profile.js");
const profilePage = read("src/pages/shared/Profile.jsx");
const globalSearch = read("src/utils/globalSearch.js");
const notifications = read("src/utils/notifications.js");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(nextName, start + 1);
  assert.notEqual(start, -1, `${name} exists`);
  return source.slice(start, end === -1 ? undefined : end);
}

test("student membership client delegates identity to the authenticated server session", () => {
  const body = functionBody(access, "getStudentElectionOrganizationIds", "export async function getStudentOrganizationDirectory");
  assert.match(body, /getStudentDashboardMemberships\(student, client\)/);
  assert.doesNotMatch(body, /getStudentExplicitOrganizations|isOrganizationEligibleForStudent|getOrganizationCatalog/);
  const currentMemberships = functionBody(access, "getStudentDashboardMemberships", "export async function getStudentOrganizationDirectory");
  assert.match(currentMemberships, /client\.functions\.invoke\("student-profile",\s*\{\s*body:\s*\{ action: "organization_memberships" \}/);
  assert.doesNotMatch(currentMemberships, /student_id:\s*student\.id|student_number|password|localStorage/);
  assert.doesNotMatch(access, /function getStoredStudentCredentials/);
});

test("public organization catalog remains available independently of a zero-member set", () => {
  const body = functionBody(access, "getStudentOrganizationDirectory", "export async function getStudentStructuralOrganizationLinks");
  assert.match(body, /getStudentDashboardMemberships\(student\)/);
  assert.match(body, /current\.memberships\.map/);
  assert.match(body, /getOrganizationCatalog\(\)/);
  assert.match(body, /otherOrganizations = .*filter/);
  assert.match(body, /memberOrganizations: memberOrganizations \|\| \[\]/);
});

test("Super Admin Students filters and affiliations use trusted current membership reads", () => {
  const attach = functionBody(superAdminStudents, "attachVisibleStudentOrganizations", "async function fetchStudents");
  const fetch = functionBody(superAdminStudents, "fetchStudents", "async function fetchOrganizations");
  assert.match(attach, /getCurrentMembershipsForStudents\(studentIds\)/);
  assert.doesNotMatch(attach, /from\("student_organizations"\)/);
  assert.match(fetch, /getCurrentOrganizationMembers\([\s\S]*?organizationFilter/);
  assert.doesNotMatch(fetch, /from\("student_organizations"\)/);
});

test("Super Admin organization details render the trusted roster directly and current-term academic context", () => {
  const details = functionBody(superAdminOrganizations, "openOrganizationDetails", "function closeOrganizationDetails");
  assert.match(details, /getCurrentOrganizationMembers\(org\.id\)/);
  assert.doesNotMatch(details, /member_student_ids|selectOrganizationMembershipsForManagement/);
  assert.match(details, /current_term_program: membership\.program/);
  assert.match(superAdminOrganizations, /student\.current_term_program/);
});

test("Student Profile affiliations use canonical current memberships, not raw structural links", () => {
  assert.match(profile, /import \{ getStudentCurrentMemberships \}/);
  assert.match(profile, /getStudentCurrentMemberships\(data\)/);
  assert.doesNotMatch(profile, /student_organizations \(/);
  assert.match(profile, /current_organization_memberships: studentOrganizations/);
  assert.match(profilePage, /user\?\.current_organization_memberships/);
});

test("Global Search counts current members through the shared count contract", () => {
  const body = functionBody(globalSearch, "countOrganizationMembers", "async function queryPrograms");
  assert.match(body, /getCurrentOrganizationMemberCount\(organizationId\)/);
  assert.doesNotMatch(body, /selectActiveMemberships|student_organizations/);
  assert.match(globalSearch, /getStudentElectionOrganizationIds\(user\)/);
});

test("zero current memberships do not manufacture a student notification or error state", () => {
  assert.doesNotMatch(notifications, /student-org-none|No organization linked yet/);
  assert.match(notifications, /organizationIds\.length\s*\?\s*fetchElections\(\)/);
  assert.match(notifications, /fetchPersistentStudentNotifications\(\)/);
  assert.doesNotMatch(notifications, /studentCredentials|student_number:.*password:/);
});

test("structural membership helper is labeled compatibility-only and not used by current reads", () => {
  assert.match(access, /Structural compatibility links; not authoritative current memberships\./);
  const currentIds = functionBody(access, "getStudentElectionOrganizationIds", "export async function getStudentOrganizationDirectory");
  assert.doesNotMatch(currentIds, /student_organizations|student\.program|organization_programs/);
  assert.doesNotMatch(access, /syncStudentOrganizationMemberships|getProgramCoveredOrganizationIds|getInstitutionWideOrganizationIds/);
});
