import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getIncomingPositionConflict,
  getIncomingStudentAvailability,
  getIncomingWinnerPositionConflict,
  getCurrentOfficerTermContext,
  getCurrentPositionConflict,
  getCurrentStudentAvailability,
  getCurrentWinnerConflict,
  formatOfficerPositionTitle,
  formatOfficerTermLabel,
  formatOfficerServicePeriod,
  getOfficerServiceDateError,
  normalizeOfficerPosition,
  sortOfficerRoster,
  submitAppointedCurrentOfficer,
} from "../src/utils/officerLeadership.js";
import { buildOfficerRpcOperation } from "../supabase/functions/_shared/officersRpcOperations.js";

const b1 = await readFile(
  new URL("../supabase/migrations/20260929110000_trusted_officers_contract.sql", import.meta.url),
  "utf8",
);
const turnover = await readFile(
  new URL("../supabase/migrations/20260929113000_incoming_officer_turnover.sql", import.meta.url),
  "utf8",
);
const rosterConsistency = await readFile(
  new URL("../supabase/migrations/20260930100000_officer_roster_consistency.sql", import.meta.url),
  "utf8",
);
const currentOfficerMigration = await readFile(
  new URL("../supabase/migrations/20260930110000_add_current_officer_rpc.sql", import.meta.url),
  "utf8",
);
const termServiceMigration = await readFile(
  new URL("../supabase/migrations/20261001100000_officer_term_context_and_service_timestamps.sql", import.meta.url),
  "utf8",
);
const leadershipYearMigration = await readFile(
  new URL("../supabase/migrations/20261001120000_officer_leadership_academic_year.sql", import.meta.url),
  "utf8",
);
const board = await readFile(new URL("../src/pages/board/Officers.jsx", import.meta.url), "utf8");
const boardElections = await readFile(new URL("../src/pages/board/Elections.jsx", import.meta.url), "utf8");
const boardElectionSetup = await readFile(new URL("../src/pages/board/BoardElectionSetup.jsx", import.meta.url), "utf8");
const superAdminElections = await readFile(new URL("../src/pages/superadmin/Elections.jsx", import.meta.url), "utf8");
const academicTermSelect = await readFile(new URL("../src/components/AcademicTermSelect.jsx", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/pages/superadmin/Officers.jsx", import.meta.url), "utf8");
const student = await readFile(new URL("../src/pages/student/Officers.jsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/pages/board/IncomingAppointmentDialog.jsx", import.meta.url), "utf8");
const officerStyles = await readFile(new URL("../src/pages/board/Officers.css", import.meta.url), "utf8");
const officersEdge = await readFile(new URL("../supabase/functions/officers-contract/index.ts", import.meta.url), "utf8");

const functionBody = (source, name) => {
  const start = source.indexOf(`function public.${name}(`);
  const privateStart = source.indexOf(`function private.${name}(`);
  const offset = start >= 0 ? start : privateStart;
  assert.notEqual(offset, -1, `${name} should exist`);
  const end = source.indexOf("$function$;", offset);
  assert.notEqual(end, -1, `${name} should terminate`);
  return source.slice(offset, end);
};

const getIncoming = functionBody(turnover, "kandid_get_incoming_leadership");
const addElected = functionBody(turnover, "kandid_add_incoming_elected_officer");
const addAppointed = functionBody(turnover, "kandid_add_incoming_appointed_officer");
const release = functionBody(turnover, "kandid_release_officer_leadership");
const addCurrent = functionBody(currentOfficerMigration, "kandid_add_current_officer");
const assignElectionTerm = functionBody(termServiceMigration, "kandid_assign_election_academic_term");
const assignReleaseContext = functionBody(termServiceMigration, "kandid_assign_officer_release_context");
const assignOfficerTerm = functionBody(termServiceMigration, "kandid_assign_officer_term_and_service");
const resolveLeadershipYear = functionBody(leadershipYearMigration, "kandid_resolve_officer_leadership_academic_year");
const assignNewRosterYear = functionBody(leadershipYearMigration, "kandid_assign_new_roster_leadership_year");
const assignReleaseYear = functionBody(leadershipYearMigration, "kandid_assign_officer_release_context");
const assignCurrentYear = functionBody(leadershipYearMigration, "kandid_assign_officer_term_and_service");

test("1. finalized results expose only the latest eligible election winners", () => {
  assert.match(getIncoming, /kandid_get_officer_winners\(null, organization_id_value\)/);
  assert.match(b1, /where e\.results_released_at is not null[\s\S]*kandid_election_is_closed\(e\.id\)[\s\S]*order by e\.results_released_at desc, e\.id desc[\s\S]*limit 1/);
});

test("officer roster hierarchy follows Kandid executive order and places representatives last", () => {
  const roster = [
    { id: 8, position_title: "Representatives" },
    { id: 7, position_title: "Business Manager" },
    { id: 6, position_title: "PRO" },
    { id: 5, position_title: "Auditor" },
    { id: 4, position_title: "Treasurer" },
    { id: 3, position_title: "Secretary" },
    { id: 2, position_title: "Vice President" },
    { id: 1, position_title: "President" },
  ];
  assert.deepEqual(sortOfficerRoster(roster).map(({ position_title }) => position_title), [
    "President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO", "Business Manager", "Representatives",
  ]);
});

test("officer position normalization handles case, whitespace, punctuation, and hyphen variants", () => {
  const roster = [
    { position_title: " representatives " },
    { position_title: " public relations officer " },
    { position_title: "P.R.O." },
    { position_title: " PRO " },
    { position_title: "  BUSINESS   MANAGER " },
    { position_title: "Vice-President" },
    { position_title: " president " },
  ];
  assert.deepEqual(sortOfficerRoster(roster).map(({ position_title }) => position_title), [
    " president ", "Vice-President", "P.R.O.", " PRO ", " public relations officer ", "  BUSINESS   MANAGER ", " representatives ",
  ]);
  assert.equal(normalizeOfficerPosition("  President  "), "president");
  assert.equal(normalizeOfficerPosition("Vice-President"), "vice-president");
});

test("officer roster supports missing positions, custom positions, and naturally ordered representatives", () => {
  const roster = [
    { id: 8, position_title: "Representatives" },
    { id: 7, position_title: "4th Year Representative" },
    { id: 6, position_title: "1st Year Representative" },
    { id: 5, position_title: "2nd Year Representative" },
    { id: 4, position_title: "3rd Year Representative" },
    { id: 3, position_title: "Historian" },
    { id: 2, position_title: "Treasurer" },
    { id: 1, position_title: "President" },
  ];
  assert.deepEqual(sortOfficerRoster(roster).map(({ position_title }) => position_title), [
    "President", "Treasurer", "Historian", "1st Year Representative", "2nd Year Representative",
    "3rd Year Representative", "4th Year Representative", "Representatives",
  ]);
  assert.deepEqual(sortOfficerRoster([{ position_title: "Secretary" }, { position_title: "President" }]).map((row) => row.position_title), ["President", "Secretary"]);
});

test("elected and appointed records share the same position hierarchy", () => {
  const roster = [
    { id: 5, selection_type: "elected", position_title: "Representatives" },
    { id: 4, selection_type: "appointed", position_title: "Treasurer" },
    { id: 3, selection_type: "appointed", position_title: "Secretary" },
    { id: 2, selection_type: "elected", position_title: "Vice President" },
    { id: 1, selection_type: "elected", position_title: "President" },
  ];
  assert.deepEqual(sortOfficerRoster(roster).map(({ position_title }) => position_title), [
    "President", "Vice President", "Secretary", "Treasurer", "Representatives",
  ]);
});

test("explicit election position ordering is preferred when the roster supplies it", () => {
  const roster = [
    { position_title: "President", position_display_order: 2 },
    { position_title: "Secretary", position_display_order: 1 },
  ];
  assert.deepEqual(sortOfficerRoster(roster).map(({ position_title }) => position_title), ["Secretary", "President"]);
  assert.deepEqual(sortOfficerRoster([
    { position_title: "President", display_order: 2 },
    { position_title: "Secretary", display_order: 1 },
  ]).map(({ position_title }) => position_title), ["President", "Secretary"]);
  assert.deepEqual(sortOfficerRoster([
    { position_title: "President", position: { display_order: 2 } },
    { position_title: "Secretary", position: { display_order: 1 } },
  ]).map(({ position_title }) => position_title), ["Secretary", "President"]);
});

test("Board, Super Admin, and Student Current/New/Past rosters reuse shared sorting", () => {
  assert.match(board, /sortOfficerRoster\(officers\.filter\(\(officer\) => officer\.is_current\)\)/);
  assert.match(board, /sortOfficerRoster\(officers\.filter\(\(officer\) => !officer\.is_current\)\)/);
  assert.match(board, /sortOfficerRoster\(incoming\?\.new_officers \|\| \[\]\)/);
  assert.match(board, /const order = String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(admin, /sortOfficerRoster\(selectedOfficers\.filter\(\(officer\) => officer\.is_current\)\)/);
  assert.match(admin, /sortOfficerRoster\(selectedOfficers\.filter\(\(officer\) => !officer\.is_current\)\)/);
  assert.match(admin, /const newOfficers = sortOfficerRoster\(selectedIncoming\?\.new_officers \|\| \[\]\)/);
  assert.match(student, /import \{[^}]*sortOfficerRoster[^}]*\} from "\.\.\/\.\.\/utils\/officerLeadership"/);
  assert.match(student, /return sortOfficerRoster\(officers\.filter/);
});

test("2. loading winners never inserts or stages officer rows", () => {
  assert.match(getIncoming, /'available_winners', available_winners/);
  assert.match(getIncoming, /'new_officers', new_officer_rows/);
  assert.doesNotMatch(getIncoming, /insert\s+into\s+public\.officer_new_roster/i);
  assert.match(getIncoming, /if position_row->>'outcome' = 'winner' then/);
  assert.match(getIncoming, /else\s+unresolved_rows := unresolved_rows \|\| pg_catalog\.jsonb_build_array\(position_row\)/);
});

test("3–4. Board explicitly stages a selected winner by candidate ID; student, election and exact won position are derived server-side", () => {
  assert.match(dialog, /onAddElected\(winner\.candidate_id, \{\}\)/);
  assert.match(board, /officersContract\("add_incoming_elected"/);
  assert.match(addElected, /where \(value->>'candidate_id'\)::integer = p_candidate_id/);
  assert.match(addElected, /election_id_value := \(incoming #>> '\{source_election,election_id\}'\)::integer/);
  assert.match(addElected, /\(winner->>'student_id'\)::integer/);
  assert.match(addElected, /\(winner->>'position_id'\)::integer/);
  assert.match(addElected, /winner->>'position_title'/);
  assert.doesNotMatch(addElected, /p_student_id|p_position_id|p_election_id/);
});

test("5. Board explicitly stages an appointed student after trusted eligibility validation", () => {
  assert.match(dialog, /onAddAppointed\(\{ student_id: studentId, position_title: positionTitle, service \}\)/);
  assert.match(board, /officersContract\("add_incoming_appointed"/);
  assert.match(addAppointed, /kandid_assert_eligible_officer_student\(organization_id_value, p_student_id\)/);
  assert.match(addAppointed, /insert into public\.officer_new_roster/);
  assert.match(addAppointed, /organization_id_value, null, 'appointed', p_student_id/);
});

test("appointed preparation remains available without published results", () => {
  assert.match(getIncoming, /where n\.organization_id = organization_id_value/);
  assert.match(getIncoming, /'source_election', null[\s\S]*'new_officers', new_officer_rows/);
  assert.doesNotMatch(addAppointed, /No released, closed election is available/);
  assert.match(dialog, /onClick=\{\(\) => setMode\("appointed"\)\}/);
  assert.match(dialog, /Boolean\(!editingOfficer && mode === "appointed"\)/);
  assert.match(admin, /disabled=\{!selectedOrganizationId\}/);
});

test("6–7. staged elected and appointed people remain visible but disabled in the appointed picker", () => {
  assert.deepEqual(getIncomingStudentAvailability(10, {
    new_officers: [{ student_id: 10, selection_type: "elected", position_title: "President" }],
  }), { available: false, reason: "Elected · President · Already added" });
  assert.deepEqual(getIncomingStudentAvailability(11, {
    new_officers: [{ student_id: 11, selection_type: "appointed", position_title: "Treasurer" }],
  }), { available: false, reason: "Appointed · Treasurer · Already added" });
  assert.match(dialog, /getIncomingStudentAvailability\(id, incoming\)/);
  assert.match(dialog, /disabled=\{unavailable \|\| busy\}/);
  assert.match(getIncoming, /'already_added', exists \([\s\S]*from public\.officer_new_roster/);
});

test("8. Current/Past history alone does not prevent staging a returning student", () => {
  assert.deepEqual(getIncomingStudentAvailability(12, { new_officers: [] }), { available: true, reason: "Eligible" });
  assert.doesNotMatch(addAppointed, /from public\.officers[\s\S]*student_id = p_student_id/);
  assert.doesNotMatch(addElected, /from public\.officers[\s\S]*student_id/);
});

test("9. duplicate staged students are rejected by trusted checks and a unique constraint", () => {
  assert.match(addAppointed, /where n\.organization_id = organization_id_value[\s\S]*n\.student_id = p_student_id/);
  assert.match(addElected, /already_added/);
  assert.match(turnover, /create unique index officer_new_roster_one_student_uidx[\s\S]*on public\.officer_new_roster \(organization_id, student_id\)/);
  assert.match(addAppointed, /pg_advisory_xact_lock/);
  assert.match(addElected, /pg_advisory_xact_lock/);
});

test("10. removing a prepared officer deletes only its scoped staging row", () => {
  const remove = functionBody(turnover, "kandid_remove_new_officer");
  assert.match(remove, /where n\.id = p_new_officer_id and n\.organization_id = organization_id_value/);
  assert.match(remove, /delete from public\.officer_new_roster n where n\.id = staged\.id/);
  assert.doesNotMatch(remove, /delete from public\.officers/);
  assert.match(board, /officersContract\("remove_new_officer"/);
  assert.match(release, /Remove officers prepared for a prior election before release/);
});

test("11–12. release moves current records to Past and activates only manually staged New records", () => {
  assert.match(release, /update public\.officers o[\s\S]*set is_current = false/);
  assert.match(release, /select n\.\* from public\.officer_new_roster n[\s\S]*where n\.organization_id = organization_id_value[\s\S]*n\.election_id is not distinct from election_id_value/);
  assert.match(release, /kandid_create_elected_officer\(/);
  assert.match(release, /kandid_create_appointed_officer\(/);
  assert.match(release, /delete from public\.officer_new_roster/);
  assert.doesNotMatch(release, /for .* in .*available_winners/i);
  assert.match(release, /perform pg_catalog\.set_config\('kandid\.allow_leadership_turnover', 'on', true\)/);
});

test("13. release is one atomic PostgreSQL function call and does not swallow failures", () => {
  assert.match(turnover, /^begin;/);
  assert.match(turnover.trimEnd(), /commit;$/);
  assert.doesNotMatch(release, /exception\s+when|pragma autonomous_transaction/i);
  assert.match(turnover, /create trigger officers_zz_guard_leadership_turnover[\s\S]*before insert or update of is_current, status/);
});

test("14. repeated release is rejected through both an explicit check and unique ledger key", () => {
  assert.match(release, /from public\.officer_leadership_releases r[\s\S]*r\.organization_id = organization_id_value and r\.election_id = election_id_value/);
  assert.match(release, /Officers for this election have already been released/);
  assert.match(turnover, /create unique index officer_leadership_releases_election_uidx[\s\S]*on public\.officer_leadership_releases \(organization_id, election_id\)[\s\S]*where election_id is not null/);
});

test("15. Board scope comes from auth.uid and trusted active admin_users; Super Admin supplies an explicit organization", () => {
  const scope = functionBody(turnover, "kandid_assert_officer_org_scope");
  assert.match(scope, /caller_uid uuid := auth\.uid\(\)/);
  assert.match(scope, /a\.status = 'active'[\s\S]*a\.role in \('electoral_board', 'super_admin'\)/);
  assert.match(scope, /if admin_row\.role = 'electoral_board' then[\s\S]*admin_row\.organization_id/);
  assert.match(scope, /else\s+organization_id_value := p_organization_id/);
  assert.match(admin, /officersContract\("release_leadership", \{ organization_id: Number\(selectedOrganizationId\) \}\)/);
});

test("16. winners request without election_id remains optional and sends null to B1", () => {
  const op = buildOfficerRpcOperation("winners", { action: "winners", organization_id: 1 });
  assert.deepEqual(op.args, { p_election_id: null, p_organization_id: 1 });
});

test("M. the winners operation also validates a supplied election_id as a positive ID", () => {
  assert.deepEqual(
    buildOfficerRpcOperation("winners", { organization_id: 1, election_id: 123 }).args,
    { p_election_id: 123, p_organization_id: 1 },
  );
  assert.throws(() => buildOfficerRpcOperation("winners", { organization_id: 1, election_id: 0 }), /Election is required/);
});

test("17. Board and Super Admin add elected and appointed officers through the same shared contract", () => {
  for (const source of [board, admin]) {
    assert.match(source, /officersContract\("add_incoming_elected"/);
    assert.match(source, /officersContract\("add_incoming_appointed"/);
    assert.match(source, /officersContract\("release_leadership"/);
  }
  assert.match(admin, /import IncomingAppointmentDialog from "\.\.\/board\/IncomingAppointmentDialog"/);
  assert.match(board, /organization_id: Number\(orgId\)/);
  assert.match(admin, /organization_id: Number\(selectedOrganizationId\)/);
});

test("18. Elected positions remain derived from trusted winners and cannot be edited", () => {
  assert.match(addElected, /winner->>'position_title'/);
  assert.match(addElected, /winner->>'position_id'/);
  assert.match(turnover, /if staged\.selection_type = 'elected' and p_changes \? 'position_title' then[\s\S]*Elected position and provenance are read-only/);
  assert.match(dialog, /Verified winners/);
});

test("19. Appointed-first conflicts preserve the winner and explain the resolution", () => {
  const conflict = getIncomingPositionConflict("President", {
    new_officers: [{ id: 6, student_id: 32, student_name: "Juan Dela Cruz", selection_type: "appointed", position_title: "  PRESIDENT  " }],
  });
  assert.match(conflict.message, /PRESIDENT is already assigned to Juan Dela Cruz as an Appointed officer/);
  assert.match(conflict.message, /Remove or change that assignment before continuing/);
  assert.match(dialog, /Resolve the existing New Officers assignment first/);
  assert.match(dialog, /incoming\?\.available_winners/);
  assert.match(dialog, /appointedPositionConflict/);
  assert.match(getIncomingWinnerPositionConflict({ student_id: 10, position_title: "President" }, {
    new_officers: [{ id: 6, student_id: 10, student_name: "Juan Dela Cruz", selection_type: "appointed", position_title: "President" }],
  }).message, /Juan Dela Cruz is already assigned President as an Appointed officer/);
  assert.match(getIncomingWinnerPositionConflict({ student_id: 10, candidate_id: 22, position_title: "Treasurer" }, {
    new_officers: [{ id: 6, student_id: 10, student_name: "Juan Dela Cruz", selection_type: "appointed", position_title: "President" }],
  }).message, /already assigned President as an Appointed officer/);
});

test("20. Elected-first blocks an appointed duplicate, and position normalization ignores case and whitespace", () => {
  assert.equal(normalizeOfficerPosition("  Vice   President "), "vice president");
  const conflict = getIncomingPositionConflict(" vice PRESIDENT ", {
    new_officers: [{ id: 2, student_id: 17, student_name: "Bren Alzaga", selection_type: "elected", position_title: "Vice President" }],
  });
  assert.match(conflict.message, /Bren Alzaga as an Elected officer/);
  assert.match(dialog, /disabled=\{busy \|\| \(!editingOfficer && !studentId\) \|\| !positionTitle\.trim\(\) \|\| Boolean\(appointedPositionConflict\)/);
});

test("21. Appointed positions and current published positions are unique per organization; history is exempt", () => {
  assert.match(rosterConsistency, /officer_new_roster_one_position_uidx/);
  assert.match(rosterConsistency, /officers_current_one_position_uidx/);
  assert.match(rosterConsistency, /where is_current/);
  assert.match(rosterConsistency, /officers_current_one_student_uidx/);
  assert.match(rosterConsistency, /where is_current and student_id is not null/);
  assert.match(rosterConsistency, /pg_catalog\.lower\(pg_catalog\.regexp_replace\(pg_catalog\.btrim\(position_title\)/);
  assert.match(rosterConsistency, /Resolve duplicate normalized positions/);
});

test("22. Same student remains unique in New roster and current roster, without historical blocking", () => {
  assert.match(turnover, /officer_new_roster_one_student_uidx[\s\S]*on public\.officer_new_roster \(organization_id, student_id\)/);
  assert.match(rosterConsistency, /officers_current_one_student_uidx/);
  assert.match(rosterConsistency, /where is_current and student_id is not null/);
  assert.doesNotMatch(rosterConsistency, /where student_id is not null;\s*$/m);
});

test("23. Board and Admin share one server roster; every incoming mutation refreshes that roster", () => {
  assert.match(board, /officersContract\("incoming_leadership"/);
  assert.match(admin, /officersContract\("incoming_leadership"/);
  assert.match(board, /await refreshLeadership\(\)/);
  assert.match(admin, /await refreshIncoming\(\)/);
  assert.match(admin, /selectedOfficers = selectedOrganizationId[\s\S]*officers\.filter/);
});

test("24. Admin student loading is lazy, retryable, scoped to the selected organization, and shared dialog keeps loading states", () => {
  assert.match(admin, /fetchEligibleStudentsForOrganization\(organizationKey\)/);
  assert.match(admin, /studentsRequestRef/);
  assert.match(admin, /studentsError/);
  assert.match(admin, /onLoadEligibleStudents=\{loadEligibleStudents\}/);
  assert.match(admin, /studentsLoaded=\{studentsLoaded && studentsOrganizationId === String\(selectedOrganizationId\)\}/);
  assert.doesNotMatch(admin, /setIncomingStudents\(\(await fetchEligibleStudentsForOrganization/);
});

test("25. Term dates are validated in the UI and trusted sanitizer", () => {
  assert.equal(getOfficerServiceDateError("2026-09-02", "2026-09-01"), "End of service must be on or after the start date.");
  assert.equal(getOfficerServiceDateError("2026-09-01", "2026-09-02"), "");
  assert.match(dialog, /serviceDateError/);
  assert.match(rosterConsistency, /term_end_value < term_start_value/);
});

test("26. Board and Admin can release through the same atomic scope-checked RPC; no approval gate is added", () => {
  assert.match(board, /officersContract\("release_leadership"/);
  assert.match(admin, /officersContract\("release_leadership"/);
  assert.match(release, /kandid_assert_officer_org_scope\(p_organization_id\)/);
  assert.match(turnover, /update public\.officers o[\s\S]*set is_current = false/);
  assert.match(turnover, /insert into public\.officer_leadership_releases/);
  assert.doesNotMatch(turnover, /approval|approved_by|pending_admin/i);
});

test("27. Students read only the released officer directory, never New roster records", async () => {
  const studentPage = await readFile(new URL("../src/pages/student/Officers.jsx", import.meta.url), "utf8");
  assert.match(studentPage, /from\("officer_directory"\)/);
  assert.doesNotMatch(studentPage, /officer_new_roster|incoming_leadership|release_leadership/);
  assert.match(b1, /create or replace view public\.officer_directory/);
  assert.match(b1, /grant select on table public\.officer_directory to anon, authenticated/);
});

test("28. The revised service sanitizer preserves its allow-list and rejects invalid date ranges", () => {
  assert.match(rosterConsistency, /key not in \('term_label', 'term_start', 'term_end', 'photo_url', 'remarks'\)/);
  assert.match(rosterConsistency, /End of service must be on or after the start date/);
  assert.match(rosterConsistency, /revoke all on function private\.kandid_sanitize_officer_service\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
});

test("29. trusted contract returns safe, actionable duplicate roster messages", () => {
  assert.match(officersEdge, /officer_new_roster_one_position_uidx[\s\S]*This position is already assigned in the New Officers roster/);
  assert.match(officersEdge, /officers_current_one_position_uidx[\s\S]*This position is already assigned to a current officer in this organization/);
  assert.match(officersEdge, /officers_current_one_student_uidx[\s\S]*This student already has a position in the current officer roster/);
  assert.match(officersEdge, /End of service must be on or after the start date/);
  assert.match(officersEdge, /The selected candidate is not a winner from the latest eligible election\./);
});

test("30. direct Current additions use one trusted RPC with the same scoped Board/Admin contract", () => {
  const operation = buildOfficerRpcOperation("add_current_officer", {
    organization_id: 12,
    selection_type: "appointed",
    student_id: 34,
    position_title: "Treasurer",
    service: { term_label: "AY 2026-2027", term_start: "2026-10-15", term_end: "2027-06-30" },
    confirm_term_context: true,
  });
  assert.equal(operation.name, "kandid_add_current_officer");
  assert.deepEqual(operation.args, {
    p_organization_id: 12,
    p_selection_type: "appointed",
    p_student_id: 34,
    p_candidate_id: null,
    p_position_title: "Treasurer",
    p_service: { term_label: "AY 2026-2027", term_start: "2026-10-15", term_end: "2027-06-30" },
    p_confirm_term_context: true,
  });
  assert.match(addCurrent, /security definer[\s\S]*set search_path = pg_catalog/i);
  assert.match(addCurrent, /kandid_assert_officer_org_scope\(p_organization_id\)/);
  assert.match(currentOfficerMigration, /revoke all on function public\.kandid_add_current_officer[\s\S]*from public, anon, authenticated/);
  assert.match(currentOfficerMigration, /grant execute on function public\.kandid_add_current_officer[\s\S]*to authenticated/);
  assert.match(board, /officersContract\("add_current_officer"/);
  assert.match(admin, /officersContract\("add_current_officer"/);
  assert.match(board, /organization_id: Number\(orgId\)/);
  assert.match(admin, /organization_id: Number\(selectedOrganizationId\)/);
  assert.match(admin, /incomingOrganizationId === String\(selectedOrganizationId\) \? incoming : null/);
  assert.match(admin, /setIncomingOrganizationId\(""\)/);
});

test("31. appointed Current inserts reuse the trusted eligible-student contract and leave existing/New rosters untouched", () => {
  assert.match(addCurrent, /kandid_assert_eligible_officer_student\(organization_id_value, student_id_value\)/);
  assert.match(addCurrent, /kandid_create_appointed_officer\([\s\S]*jsonb_build_object\('is_current', true\)/);
  assert.doesNotMatch(addCurrent, /update\s+public\.officers|delete\s+from\s+public\.officers|officer_new_roster/i);
  assert.match(addCurrent, /set_config\('kandid\.allow_leadership_turnover', 'on', true\)/);
  assert.match(addCurrent, /pg_advisory_xact_lock\(913027, organization_id_value::integer\)/);
  assert.match(board, /Add to New Officers/);
  assert.match(admin, /Add to New Officers/);
  assert.match(board, /Add to Current/);
  assert.match(admin, /Add to Current/);
});

test("32. elected Current additions accept only a trusted unique winner and derive its student and position", () => {
  assert.match(addCurrent, /if p_candidate_id is null or p_student_id is not null[\s\S]*An elected officer must be selected by verified candidate ID only/);
  assert.match(addCurrent, /join public\.positions p on p\.id = c\.position_id[\s\S]*join public\.elections e on e\.id = p\.election_id/);
  assert.match(addCurrent, /candidate_row\.organization_id is distinct from organization_id_value/);
  assert.match(addCurrent, /candidate_row\.results_released_at is null[\s\S]*kandid_election_is_closed/);
  assert.match(addCurrent, /kandid_get_officer_winners\(null, organization_id_value\)/);
  assert.match(addCurrent, /winner_result #>> '\{selected_election,election_id\}'\)::integer is distinct from candidate_row\.election_id/);
  assert.match(addCurrent, /The selected candidate is not a winner from the latest eligible election\./);
  assert.match(addCurrent, /value->>'outcome' = 'winner'[\s\S]*value->>'candidate_id'[\s\S]*value->>'position_id'/);
  assert.match(addCurrent, /kandid_create_elected_officer\([\s\S]*jsonb_build_object\('is_current', true\)/);
  assert.doesNotMatch(addCurrent, /p_position_title\s*,\s*service_value[\s\S]*'elected'/);
});

test("direct elected Current additions reject older, foreign, tied, zero-vote, and non-winner candidates", () => {
  assert.match(getIncoming, /kandid_get_officer_winners\(null, organization_id_value\)/);
  assert.match(b1, /where e\.results_released_at is not null[\s\S]*and \(p_organization_id is null or e\.organization_id = p_organization_id\)[\s\S]*kandid_election_is_closed\(e\.id\)[\s\S]*order by e\.results_released_at desc, e\.id desc[\s\S]*limit 1/);
  assert.match(addCurrent, /candidate_row\.organization_id is distinct from organization_id_value[\s\S]*kandid_get_officer_winners\(null, organization_id_value\)[\s\S]*selected_election,election_id[\s\S]*candidate_row\.election_id/);
  assert.match(addCurrent, /value->>'outcome' = 'winner'[\s\S]*value->>'candidate_id'[\s\S]*value->>'position_id'/);
  assert.match(b1, /when s\.candidate_id is null or s\.highest_total = 0 then 'no_winner'[\s\S]*when s\.highest_candidate_count > 1 then 'tie'/);
  assert.doesNotMatch(addCurrent, /kandid_get_officer_winners\(candidate_row\.election_id, organization_id_value\)/);
});

test("33. normalized Current position and student duplicates get clear UI feedback and trusted database protection", () => {
  const current = [
    { student_id: 34, position_title: "  PRESIDENT  ", student_name: "Justin Chua" },
  ];
  const positionConflict = getCurrentPositionConflict("president", current);
  assert.match(positionConflict.message, /President is already occupied by Justin Chua/);
  const studentAvailability = getCurrentStudentAvailability("34", current);
  assert.equal(studentAvailability.available, false);
  assert.match(studentAvailability.reason, /already serving as President in Current Leadership/);
  assert.match(getCurrentWinnerConflict({ student_id: 34, position_title: "Treasurer" }, current).message, /already serving/);
  assert.match(addCurrent, /lower\(pg_catalog\.regexp_replace\(pg_catalog\.btrim\(o\.position_title\)/);
  assert.match(addCurrent, /o\.student_id = student_id_value/);
  assert.match(rosterConsistency, /officers_current_one_position_uidx/);
  assert.match(rosterConsistency, /officers_current_one_student_uidx/);
  assert.match(officersEdge, /officers_current_one_position_uidx/);
  assert.match(officersEdge, /officers_current_one_student_uidx/);
});

test("34. Current leadership academic year is inherited without manual confirmation", () => {
  const context = getCurrentOfficerTermContext([
    { leadership_academic_year: "2026-2027", term_start: "2026-08-01", term_end: "2027-06-30" },
    { leadership_academic_year: " 2026-2027 ", term_start: "2026-08-01", term_end: "2027-06-30" },
  ]);
  assert.equal(context.defaults.term_label, "AY 2026-2027");
  assert.equal(context.defaults.leadership_academic_year, "2026-2027");
  assert.equal(context.defaults.term_start, "2026-08-01");
  assert.equal(context.defaults.term_end, "2027-06-30");
  assert.equal(context.requiresConfirmation, false);
  assert.equal(context.leadershipYearAmbiguous, false);
  assert.equal(context.termEndAmbiguous, false);
  assert.equal(context.termStartAmbiguous, false);
  assert.equal(getCurrentOfficerTermContext([]).requiresConfirmation, false);
  const missingTermContext = getCurrentOfficerTermContext([
    { leadership_academic_year: "2026-2027", term_end: "2027-06-30" },
    { leadership_academic_year: "2026-2027", term_end: null },
  ]);
  assert.equal(missingTermContext.requiresConfirmation, false);
  assert.equal(missingTermContext.termEndAmbiguous, true);
  const endConflict = getCurrentOfficerTermContext([
    { leadership_academic_year: "2026-2027", term_end: "2027-06-30" },
    { leadership_academic_year: "2026-2027", term_end: "2027-05-30" },
  ]);
  assert.equal(endConflict.leadershipYearAmbiguous, false);
  assert.equal(endConflict.termEndAmbiguous, true);
  assert.match(dialog, /Resolved from Kandid's leadership context/);
  assert.match(termServiceMigration, /Ignore legacy client labels and starts/);
  assert.match(termServiceMigration, /'term_end', p_service->>'term_end'/);
});

test("35. officer positions render in canonical Kandid title case across all rosters", () => {
  assert.equal(formatOfficerPositionTitle("treasurer"), "Treasurer");
  assert.equal(formatOfficerPositionTitle(" president "), "President");
  assert.equal(formatOfficerPositionTitle("vice president"), "Vice President");
  assert.equal(formatOfficerPositionTitle("Vice-President"), "Vice President");
  assert.equal(formatOfficerPositionTitle("PRO"), "Public Relations Officer");
  assert.equal(formatOfficerPositionTitle("P.R.O."), "Public Relations Officer");
  assert.equal(formatOfficerPositionTitle("public relations officer"), "Public Relations Officer");
  assert.equal(formatOfficerPositionTitle("4th year representative"), "4th Year Representative");
  assert.equal(formatOfficerPositionTitle("  records   officer "), "Records Officer");
  for (const source of [board, admin, student]) {
    assert.match(source, /formatOfficerPositionTitle\(officer\.position_title\)/);
  }
  assert.match(dialog, /formatOfficerPositionTitle\(winner\.position_title\)/);
});

test("36. Board and Super Admin share explicit Current/New destinations and refresh only after a successful direct insert", () => {
  assert.match(board, /function openOfficerForm\(target = null\)/);
  assert.match(board, /onClick=\{\(\) => openOfficerForm\("current"\)\}/);
  assert.match(board, /onClick=\{\(\) => openOfficerForm\("new"\)\}/);
  assert.match(board, /await refreshLeadership\(\)/);
  assert.match(admin, /OfficerDestinationDialog/);
  assert.match(admin, /setCurrentAddOpen\(true\)/);
  assert.match(admin, /setAppointmentOpen\(true\)/);
  assert.match(admin, /await refreshIncoming\(\)/);
  assert.match(dialog, /target = "new"/);
  assert.match(dialog, /target === "current" \? "Add to Current Leadership" : "Add to New Officers"/);
});

test("37. direct Current additions re-sort by shared hierarchy and the displayed numbers derive from sorted rows", () => {
  const sorted = sortOfficerRoster([
    { student_id: 3, position_title: "Treasurer", selection_type: "appointed" },
    { student_id: 2, position_title: "Secretary", selection_type: "elected" },
    { student_id: 1, position_title: "President", selection_type: "elected" },
  ]);
  assert.deepEqual(sorted.map((officer) => officer.position_title), ["President", "Secretary", "Treasurer"]);
  assert.match(board, /sortOfficerRoster\(officers\.filter\(\(officer\) => officer\.is_current\)\)/);
  assert.match(admin, /sortOfficerRoster\(selectedOfficers\.filter\(\(officer\) => officer\.is_current\)\)/);
  assert.match(board, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
});

test("38. Student Officers already reads current rows from the published directory", () => {
  assert.match(student, /from\("officer_directory"\)/);
  assert.match(b1, /create or replace view public\.officer_directory/);
  assert.match(b1, /o\.is_current/);
  assert.match(student, /filter === "current" && !officer\.is_current/);
  assert.doesNotMatch(student, /officer_new_roster|incoming_leadership/);
});

test("39. New roster release remains its independent atomic replacement path", () => {
  assert.match(board, /officersContract\("release_leadership"/);
  assert.match(admin, /officersContract\("release_leadership"/);
  assert.match(release, /update public\.officers o[\s\S]*set is_current = false/);
  assert.match(release, /kandid_create_elected_officer\(/);
  assert.match(release, /kandid_create_appointed_officer\(/);
  assert.match(addCurrent, /return created_officer \|\| pg_catalog\.jsonb_build_object\('target', 'current'\)/);
  assert.doesNotMatch(addCurrent, /kandid_release_officer_leadership/);
});

test("40. Appointed Current inherits leadership year and records service start on the server", () => {
  const context = getCurrentOfficerTermContext([
    { leadership_academic_year: "2026-2027", term_start: "2026-08-01", term_end: "2027-06-30" },
  ]);
  assert.equal(context.requiresConfirmation, false);
  assert.equal(context.defaults.term_label, "AY 2026-2027");
  assert.equal(context.defaults.leadership_academic_year, "2026-2027");
  assert.equal(context.defaults.term_end, "2027-06-30");
  assert.doesNotMatch(dialog, /currentTermContext\.defaults\.term_label/);
  assert.match(dialog, /Service begins when this officer is added to Current Leadership/);
  assert.match(dialog, /Leadership year/);
  assert.doesNotMatch(dialog, /Start of service|appointedServiceStart|termLabel, setTermLabel/);
  assert.match(dialog, /if \(selectedWinner\) onAddCurrentElected\?\.\(selectedWinner\.candidate_id, service, false\)/);
  assert.match(termServiceMigration, /Ignore legacy client labels and starts[\s\S]*'term_end', p_service->>'term_end'/);
  assert.match(addCurrent, /created_officer := public\.kandid_create_appointed_officer\([\s\S]*jsonb_build_object\('is_current', true\)/);
  assert.doesNotMatch(addCurrent, /update\s+public\.officers|delete\s+from\s+public\.officers|officer_new_roster/i);
  assert.match(leadershipYearMigration, /service_started_at := start_timestamp/);
  assert.match(student, /from\("officer_directory"\)/);
});

test("officer display prefers academic-year tenure over semester or legacy labels", () => {
  assert.equal(formatOfficerTermLabel({
    leadership_academic_year: "2026-2027",
    academic_term_id: 1,
    academic_term: { semester: "1st Semester", academic_year: "2026-2027" },
    term_label: "1st Semester AY 2026-2027",
  }), "AY 2026–2027");
  assert.equal(formatOfficerTermLabel({ leadership_academic_year: "2026-2027", term_label: "2025-2026" }), "AY 2026–2027");
  assert.equal(formatOfficerTermLabel({ academic_term_id: 1, academic_term: { semester: "1st Semester", academic_year: "2026-2027" }, term_label: "2026-2027" }), "1st Semester AY 2026–2027");
  assert.equal(formatOfficerTermLabel({ academic_term_id: 1, term_label: "2026-2027" }), "");
  assert.equal(formatOfficerTermLabel({ academic_term_id: null, term_label: "2026-2027" }), "AY 2026–2027");
  assert.equal(formatOfficerPositionTitle("PIO"), "PIO");

  assert.match(officersEdge, /term_label, term_start, term_end, academic_term_id, leadership_academic_year/);
  assert.match(board, /formatOfficerTermLabel\(officer\)/);
  assert.match(board, /formatOfficerTermLabel\(editingOfficer\)/);
  assert.doesNotMatch(board, /officer\.term_label\}\}/);
  assert.match(student, /leadership_academic_year/);
});

test("elected officer tenure derives only from its linked election academic year", () => {
  assert.match(leadershipYearMigration, /update public\.officers o[\s\S]*from public\.elections e\s+join public\.academic_terms t on t\.id = e\.academic_term_id[\s\S]*o\.election_id = e\.id/);
  assert.match(assignNewRosterYear, /if new\.selection_type = 'elected' then[\s\S]*private\.kandid_resolve_officer_leadership_academic_year\([\s\S]*new\.organization_id, new\.election_id/);
  assert.match(resolveLeadershipYear, /where e\.id = p_election_id\s+and e\.organization_id = p_organization_id/);
  assert.match(assignCurrentYear, /new\.leadership_academic_year := election_year/);
  assert.doesNotMatch(leadershipYearMigration, /leadership_academic_year\s*=\s*[^;]*(results_released_at|service_started_at|created_at)/i);
});

test("appointed Current inherits one Current leadership year or one active academic year", () => {
  assert.match(resolveLeadershipYear, /count\(distinct o\.leadership_academic_year\)[\s\S]*o\.is_current/);
  assert.match(resolveLeadershipYear, /if current_year_count > 1 then[\s\S]*conflicting academic years/);
  assert.match(resolveLeadershipYear, /elsif current_year_count = 1 then\s+return leadership_year/);
  assert.match(resolveLeadershipYear, /count\(distinct t\.academic_year\)[\s\S]*where t\.status = 'active'/);
  assert.match(resolveLeadershipYear, /active_year_count <> 1[\s\S]*Establish one authoritative academic year/);
  assert.match(assignCurrentYear, /private\.kandid_resolve_officer_leadership_academic_year\(new\.organization_id, null\)/);
  assert.match(assignCurrentYear, /new\.service_started_at := start_timestamp/);
  assert.match(leadershipYearMigration, /'current_leadership_academic_year', current_leadership_year/);
  assert.match(dialog, /incoming\?\.current_leadership_academic_year !== undefined[\s\S]*incoming\?\.leadership_academic_year/);
});

test("semester activation within one academic year does not transition officer lifecycle", () => {
  assert.doesNotMatch(leadershipYearMigration, /create trigger[^;]*on public\.academic_terms[\s\S]*officer/i);
  assert.match(resolveLeadershipYear, /count\(distinct t\.academic_year\)[\s\S]*where t\.status = 'active'/);
  assert.doesNotMatch(leadershipYearMigration, /update public\.officers[\s\S]*set (?:is_current|service_started_at|service_ended_at|academic_term_id)\s*=/i);
  assert.match(assignCurrentYear, /new\.academic_term_id := old\.academic_term_id/);
  assert.match(assignCurrentYear, /new\.service_started_at := old\.service_started_at/);
  assert.match(assignCurrentYear, /new\.service_ended_at := old\.service_ended_at/);
});

test("New-to-Current release requires one matching staged leadership year and uses release time", () => {
  assert.match(assignReleaseYear, /if has_elected_staging then[\s\S]*new\.organization_id, new\.election_id[\s\S]*else[\s\S]*new\.organization_id, null/);
  assert.match(assignReleaseYear, /if has_elected_staging and new\.election_id is not null then[\s\S]*e\.academic_term_id/);
  assert.match(assignReleaseYear, /appointed-only roster[\s\S]*not that unrelated election's semester/);
  assert.match(assignReleaseYear, /staged_unresolved > 0 or staged_year_count <> 1[\s\S]*staged_year is distinct from new\.leadership_academic_year/);
  assert.match(assignCurrentYear, /start_timestamp := release_at/);
  assert.match(assignCurrentYear, /if not old\.is_current and new\.is_current then[\s\S]*new\.service_started_at := start_timestamp/);
  assert.match(assignReleaseYear, /new\.term_label := 'AY ' \|\| new\.leadership_academic_year/);
});

test("leadership year backfill uses only authoritative academic-term/election links", () => {
  assert.match(leadershipYearMigration, /o\.academic_term_id = t\.id/);
  assert.match(leadershipYearMigration, /o\.selection_type = 'elected'[\s\S]*o\.election_id = e\.id[\s\S]*o\.organization_id = e\.organization_id/);
  assert.match(leadershipYearMigration, /r\.academic_term_id = t\.id/);
  assert.match(leadershipYearMigration, /r\.elected_count > 0[\s\S]*r\.election_id = e\.id/);
  assert.doesNotMatch(leadershipYearMigration, /set leadership_academic_year\s*=\s*(?:'[^']*'|[^;]*(?:term_label|service_started_at|service_ended_at|created_at|results_released_at))/i);
  assert.doesNotMatch(leadershipYearMigration, /update public\.(?:officer_new_roster|officer_leadership_releases)[\s\S]*set (?:is_current|released_at)\s*=/i);
});

test("officer-directory and incoming contract expose leadership academic year", () => {
  const directoryView = leadershipYearMigration.slice(leadershipYearMigration.indexOf("create or replace view public.officer_directory"));
  assert.match(directoryView, /o\.leadership_academic_year[\s\S]*from public\.officers/);
  assert.match(officersEdge, /leadership_academic_year/);
  assert.match(officersEdge, /kandid_get_officer_leadership_context/);
  assert.match(leadershipYearMigration, /grant execute on function public\.kandid_get_officer_leadership_context\(bigint\)\s+to authenticated/);
});

test("Appointed Current submission has no manual term or start date and calls once", async () => {
  let calls = 0;
  let submitted;
  const result = await submitAppointedCurrentOfficer({
    studentId: "35",
    positionTitle: "Treasurer",
    positionConflict: null,
    serviceDateError: "",
    service: { term_end: "2027-06-30" },
    onSubmit: async (payload) => { calls += 1; submitted = payload; },
  });
  assert.deepEqual(result, { submitted: true });
  assert.equal(calls, 1);
  assert.deepEqual(submitted, {
    student_id: "35",
    position_title: "Treasurer",
    service: { term_end: "2027-06-30" },
    confirm_term_context: false,
  });
  assert.doesNotMatch(JSON.stringify(submitted), /term_label|term_start/);
  assert.match(dialog, /disabled=\{busy \|\| \(!editingOfficer && !studentId\)[\s\S]*Boolean\(serviceDateError\)/);
  assert.match(officerStyles, /\.board-officer-submit:disabled[\s\S]*cursor: not-allowed[\s\S]*background: #e8e4dc/);
});

test("Current service timestamps use server transaction/release time, never election results time", () => {
  assert.match(termServiceMigration, /add column if not exists academic_term_id integer[\s\S]*references public\.academic_terms\(id\)/);
  assert.match(termServiceMigration, /add column if not exists service_started_at timestamptz/);
  assert.match(termServiceMigration, /add column if not exists service_ended_at timestamptz/);
  assert.match(termServiceMigration, /select e\.academic_term_id into new\.academic_term_id[\s\S]*where e\.id = new\.election_id/);
  assert.match(assignElectionTerm, /if new\.academic_term_id is null then[\s\S]*Choose the academic term this election belongs to/);
  assert.doesNotMatch(assignElectionTerm, /where t\.status = 'active'/);
  assert.match(termServiceMigration, /if new\.is_current then[\s\S]*new\.academic_term_id := null;[\s\S]*new\.term_label := null/);
  assert.match(assignOfficerTerm, /count\(distinct o\.academic_term_id\)::integer,[\s\S]*min\(o\.academic_term_id\)[\s\S]*o\.organization_id = new\.organization_id and o\.is_current/);
  assert.doesNotMatch(assignOfficerTerm, /count\(\*\) filter \(where o\.academic_term_id is null\)|count\(distinct[^;]*term_label/i);
  assert.match(assignOfficerTerm, /elsif term_count > 1 then[\s\S]*conflicting academic-term context/);
  assert.match(assignOfficerTerm, /else[\s\S]*from public\.academic_terms t[\s\S]*where t\.status = 'active'[\s\S]*Establish or select an academic term for Current Leadership/);
  assert.match(assignOfficerTerm, /if not old\.is_current and new\.is_current then[\s\S]*select e\.academic_term_id into election_term_id[\s\S]*new\.academic_term_id := coalesce\(old\.academic_term_id, election_term_id\)/);
  assert.match(termServiceMigration, /start_timestamp := coalesce\(release_at, transaction_timestamp\(\)\)/);
  assert.match(termServiceMigration, /end_timestamp := coalesce\(release_at, transaction_timestamp\(\)\)/);
  assert.match(termServiceMigration, /timezone\('Asia\/Manila', start_timestamp\)::date/);
  assert.match(termServiceMigration, /released_at >= transaction_timestamp\(\)/);
  assert.match(assignReleaseContext, /where e\.id = new\.election_id and e\.organization_id = new\.organization_id[\s\S]*Choose an academic term for the election before releasing leadership/);
  assert.match(assignReleaseContext, /count\(distinct o\.academic_term_id\)::integer[\s\S]*where o\.organization_id = new\.organization_id and o\.is_current/);
  assert.doesNotMatch(assignReleaseContext, /o\.term_label/);
  assert.match(termServiceMigration, /select r\.released_at, r\.academic_term_id/);
  assert.match(termServiceMigration, /create trigger officers_assign_term_and_service[\s\S]*before insert or update of is_current/);
  assert.doesNotMatch(termServiceMigration, /service_started_at\s*:=\s*candidate_row\.results_released_at/);
  assert.match(termServiceMigration, /results_released_at/); // Winner validation remains intact.
  assert.match(termServiceMigration, /o\.service_started_at,[\s\S]*o\.service_ended_at/);
  assert.match(officersEdge, /service_started_at, service_ended_at/);
  assert.match(student, /service_started_at, service_ended_at/);
  assert.doesNotMatch(board, /No term label|Period not set/);
  assert.doesNotMatch(admin, /No term label|Period not set/);
  assert.doesNotMatch(student, /Not specified/);
  assert.equal(formatOfficerServicePeriod({
    service_started_at: "2026-09-30T16:00:00.000Z",
    service_ended_at: "2027-05-31T16:00:00.000Z",
  }), "Served Oct 1, 2026 – Jun 1, 2027");
  assert.equal(formatOfficerServicePeriod({ is_current: true }), "");
});

test("elections require an explicitly selected academic term in Board and Super Admin forms", () => {
  assert.match(academicTermSelect, /listAcademicTerms\(\)/);
  assert.match(academicTermSelect, /Choose the academic term this election belongs to; it is not inferred from the active term/);
  assert.match(boardElectionSetup, /Academic term/);
  assert.match(boardElectionSetup, /required[\s\S]*value=\{form\.academic_term_id\}/);
  assert.match(boardElections, /academic_term_id: Number\(form\.academic_term_id\)/);
  assert.match(superAdminElections, /academic_term_id: Number\(form\.academic_term_id\)/);
  assert.match(superAdminElections, /label className="field-label" htmlFor="sa-election-academic-term">Academic Term/);
  assert.match(superAdminElections, /if \(!form\.academic_term_id\)[\s\S]*Choose the academic term this election belongs to/);
  assert.match(assignElectionTerm, /old\.academic_term_id is not null and new\.academic_term_id is distinct from old\.academic_term_id/);
  assert.match(boardElections, /academic_term_id: election\.academic_term_id \?\? ""/);
  assert.match(superAdminElections, /academic_term_id: election\.academic_term_id \?\? ""/);
});

test("Current appointment preserves existing Current and New roster records", () => {
  assert.doesNotMatch(addCurrent, /update\s+public\.officers|delete\s+from\s+public\.officers|officer_new_roster/i);
  assert.match(termServiceMigration, /if old\.is_current and not new\.is_current then[\s\S]*service_ended_at := end_timestamp/);
  assert.match(release, /insert into public\.officer_leadership_releases[\s\S]*update public\.officers o[\s\S]*set is_current = false/);
});

test("Appointed submission correction leaves Elected and New Officers submit paths unchanged", () => {
  assert.match(dialog, /if \(selectedWinner\) onAddCurrentElected\?\.\(selectedWinner\.candidate_id, service, false\)/);
  assert.match(dialog, /mode === "appointed"\) \{[\s\S]*target === "current"[\s\S]*submitAppointedCurrentOfficer\([\s\S]*else \{\s*await onAddAppointed\(/);
  assert.match(dialog, /Add winner to Current/);
  assert.match(dialog, /Add to New Officers/);
});
