import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/pages/superadmin/Organizations.css", import.meta.url),
  "utf8",
);

test("Organizations keeps the shared header and removes duplicate directory status", () => {
  assert.match(page, /<SuperAdminPageHeader[\s\S]*?title="Organizations"/);
  assert.match(page, /className="sa-organizations-add"[\s\S]*?Add organization/);
  assert.doesNotMatch(page, /Directory status|registered`\s*\}/i);
  assert.match(page, /01 \/ Registered/);
});

test("organization records group identity, operational metadata, and row actions", () => {
  assert.doesNotMatch(page, /sa-organizations-column-head|<span>Index<\/span>|<span>Membership<\/span>|<span>Actions<\/span>/);
  assert.match(page, /Institutional directory/);
  assert.match(page, /sa-organizations-record-meta/);
  assert.match(page, /View member record/);
  assert.match(page, /aria-label=\{`Edit \$\{org\.name\}`\}/);
  assert.match(page, /aria-label=\{`Delete \$\{org\.name\}`\}/);
  assert.match(styles, /grid-template-columns:\s*3rem minmax\(16rem, 1\.65fr\) minmax\(17rem, 1fr\) auto/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.sa-organizations-record-meta,\s*\.sa-organizations-actions,\s*\.sa-organizations-mobile-actions\s*\{\s*grid-column: 2;/);
});

test("mobile Organizations presents trusted metrics in a compact 2 by 2 register", () => {
  const summary = page.slice(
    page.indexOf('className="sa-organizations-summary"'),
    page.indexOf('className="sa-organizations-directory"'),
  );

  assert.match(summary, /01 \/ Registered[\s\S]*?\{organizations\.length\}/);
  assert.match(summary, /02 \/ Departmental[\s\S]*?\{organizationSummary\.departmental\}/);
  assert.match(summary, /03 \/ Non-departmental[\s\S]*?\{organizationSummary\.nonDepartmental\}/);
  assert.match(summary, /04 \/ Memberships[\s\S]*?organizationSummary\.membershipCountsComplete[\s\S]*?organizationSummary\.activeMemberships/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-organizations-summary\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.sa-organizations-summary-item:nth-child\(1\)\s*\{\s*grid-column: 1; grid-row: 1;/);
  assert.match(styles, /\.sa-organizations-summary-item:nth-child\(4\)\s*\{\s*grid-column: 2; grid-row: 1;/);
  assert.match(styles, /\.sa-organizations-summary-item:nth-child\(2\)\s*\{\s*grid-column: 1; grid-row: 2;/);
  assert.match(styles, /\.sa-organizations-summary-item:nth-child\(3\)\s*\{\s*grid-column: 2; grid-row: 2;/);
  assert.match(styles, /\.sa-organizations-summary-item > small \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("mobile directory reaches organization rows sooner without changing desktop identity", () => {
  assert.match(page, /sa-organizations-directory-label-desktop">Organization records/);
  assert.match(page, /sa-organizations-directory-label-mobile">Institutional directory/);
  assert.match(page, /sa-organizations-directory-title-desktop">Institutional directory/);
  assert.match(page, /sa-organizations-directory-title-mobile">Organization records/);
  assert.doesNotMatch(page, /sa-organizations-directory-count|filteredOrganizations\.length organization records/);
  assert.match(page, /className="sa-organizations-add"[\s\S]*?Add organization/);
  assert.match(styles, /\.sa-organizations \.sa-page-header-actions,\s*\.sa-organizations \.sa-organizations-add \{ width: 100%; \}/);
  assert.match(styles, /\.sa-organizations-directory\s*\{\s*margin-top: 1\.1rem;/);
  assert.match(styles, /\.sa-organizations-filters\s*\{[^}]*grid-column: 1 \/ -1/s);
  assert.match(styles, /\.sa-organizations-filters button\s*\{[^}]*min-height: 2\.45rem/s);
  assert.match(styles, /\.sa-organizations-identity-copy > span \{ font-size: 0\.75rem; line-height: 1\.38; \}/);
  assert.match(styles, /\.sa-organizations-actions \{ justify-content: flex-start; gap: 0\.75rem; \}/);
});

test("mobile organization records combine type and trusted member availability", () => {
  assert.match(page, /const mobileMemberSummary = organizationCountsLoading[\s\S]*?"MEMBERS LOADING"[\s\S]*?Number\.isInteger\(studentCount\)[\s\S]*?`\$\{studentCount\} MEMBERS`[\s\S]*?"MEMBERS UNAVAILABLE"/);
  assert.match(page, /className="sa-organizations-mobile-meta"[^>]*aria-label=\{`\$\{getOrganizationTypeLabel\(org\)\} · \$\{mobileMemberSummary\}`\}/);
  assert.match(page, /sa-organizations-mobile-meta-dot/);
  assert.match(styles, /\.sa-organizations-record-meta > \.sa-organizations-type,[\s\S]*?\.sa-organizations-record-meta > \.sa-organizations-membership \{ display: none; \}/);
  assert.match(styles, /\.sa-organizations-mobile-meta\s*\{\s*display: flex;/);
  assert.match(styles, /\.sa-organizations-type > small \{ display: none; \}/);
  assert.match(styles, /\.sa-organizations-membership strong/);
});

test("mobile organization actions keep member record primary and administrative actions in an accessible overflow menu", () => {
  const menu = page.slice(
    page.indexOf("function OrganizationMobileActions"),
    page.indexOf("function Organizations"),
  );

  assert.match(menu, /className="sa-organizations-mobile-view"[\s\S]*?onClick=\{onViewMembers\}/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /aria-controls=\{menuId\}/);
  assert.match(menu, /role="menu"[\s\S]*?role="menuitem"[\s\S]*?Edit organization[\s\S]*?role="menuitem"[\s\S]*?Delete organization/);
  assert.match(menu, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(menu, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(menu, /event\.key !== "Escape"/);
  assert.match(menu, /ArrowDown.*ArrowUp.*Home.*End/s);
  assert.match(page, /onEdit=\{\(\) => openEditForm\(org\)\}/);
  assert.match(page, /onDelete=\{\(\) => handleDelete\(org\.id\)\}/);
  assert.match(styles, /\.sa-organizations-mobile-actions,\s*\.sa-organizations-mobile-meta \{ display: none; \}/);
  assert.match(styles, /\.sa-organizations-actions \{ display: none; \}/);
  assert.match(styles, /\.sa-organizations-overflow-trigger\s*\{\s*display: grid;\s*width: 2\.75rem;\s*height: 2\.75rem;/);
  assert.match(styles, /\.sa-organizations-overflow-menu button \{\s*min-height: 2\.75rem;/);
  assert.match(styles, /\.sa-organizations-mobile-actions button:focus-visible/);
});

test("Super Admin organization counts and member detail use the trusted current-term membership contract", () => {
  assert.match(page, /getCurrentOrganizationMemberCount\(org\.id\)/);
  assert.match(page, /getCurrentOrganizationMembers\(org\.id\)/);
  assert.match(page, /membership\.student/);
  assert.match(page, /setOrganizationMemberCount\(count\)/);
  assert.match(page, /Current-term active memberships/);
  assert.match(page, /Current-term members/);
  assert.doesNotMatch(page, /const \{ data, error \} = await selectActiveMemberships\([\s\S]*?student_id, organization_id/);
  assert.match(page, /Current organization members could not be verified/);
  assert.match(page, /counts\[organizationId\] = error \? null : data\.count/);
});

test("organization member details use a compact institutional record sheet", () => {
  const memberRecord = page.slice(
    page.indexOf("{/* ORGANIZATION MEMBER RECORD */}"),
    page.indexOf("{/* CREATE / EDIT ORGANIZATION */}"),
  );

  assert.match(memberRecord, /className="popup-sheet popup-sheet-wide sa-org-member-sheet"/);
  assert.match(memberRecord, /role="dialog"[\s\S]*?aria-labelledby="sa-org-member-title"/);
  assert.match(memberRecord, /Organization member record/);
  assert.match(memberRecord, /id="sa-org-member-title">\{selectedOrg\.name\}/);
  assert.match(memberRecord, /getOrganizationTypeLabel\(selectedOrg\)/);
  assert.match(memberRecord, /Added \{selectedOrg\.created_at/);
  assert.match(memberRecord, /01 \/ Organization/);
  assert.match(memberRecord, /02 \/ Classification/);
  assert.match(memberRecord, /03 \/ Current term/);
  assert.match(memberRecord, /formatOrganizationAcademicTerm\(organizationMemberTerm\)/);
  assert.doesNotMatch(memberRecord, /metric-card|rounded-2xl border border-gray-200|<table/);
  assert.match(styles, /\.popup-sheet\.sa-org-member-sheet/);
  assert.match(styles, /--kandid-app-border:\s*#e5e0d6/);
  assert.match(styles, /\.sa-org-member-body\s*\{[^}]*overflow:\s*auto/s);
  assert.match(styles, /\.sa-org-member-footer\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-org-member-row/);
});

test("member record exposes one truthful current-term removal action", () => {
  const memberRecord = page.slice(
    page.indexOf("{/* ORGANIZATION MEMBER RECORD */}"),
    page.indexOf("{/* CREATE / EDIT ORGANIZATION */}"),
  );

  assert.match(page, /setOrganizationMemberCount\(count\)/);
  assert.match(page, /setOrganizationMemberTerm\(academicTerm \|\| null\)/);
  assert.doesNotMatch(page, /member_student_ids|students\.length !==/);
  assert.match(memberRecord, /\["Account", "account"\]/);
  assert.match(memberRecord, /\["Membership", "membership"\]/);
  assert.match(memberRecord, /getAccountStatusLabel\(student\.status\)/);
  assert.match(memberRecord, /className="sa-org-member-status is-current">Active/);
  assert.match(memberRecord, /MEMBERSHIP|Membership/);
  assert.doesNotMatch(memberRecord, /Deactivate|Reactivate/);
  assert.match(memberRecord, /Remove current-term membership for /);
  assert.match(memberRecord, /Remove membership/);
  assert.match(page, /removeSuperAdminCurrentOrganizationMembership\(/);
  assert.match(page, /Their student record, enrollment, organization link, and history will remain/);
  assert.doesNotMatch(page, /removeStudentOrganizationMembership|analyzeMembershipDependencies/);
  assert.match(styles, /\.sa-org-member-action\.is-danger\s*\{[^}]*color:/s);
});

test("member registry uses four editorial groups and keeps removal with membership", () => {
  const memberRecord = page.slice(
    page.indexOf("{/* ORGANIZATION MEMBER RECORD */}"),
    page.indexOf("{/* CREATE / EDIT ORGANIZATION */}"),
  );

  assert.deepEqual([...memberRecord.matchAll(/\["(Student|Academic|Account|Membership)", "(student|academic|account|membership)"\]/g)].map((match) => match[1]), [
    "Student",
    "Academic",
    "Account",
    "Membership",
  ]);
  assert.doesNotMatch(memberRecord, /\["Actions"|sa-org-member-actions|is-student-id|is-program|is-year/);
  assert.match(memberRecord, /organizationStudents\.map\(\(student, index\)/);
  assert.match(memberRecord, /sa-org-member-sequence[^>]*aria-hidden="true">\{String\(index \+ 1\)\.padStart\(2, "0"\)\}/);
  assert.doesNotMatch(memberRecord, /\["#"|columnheader[^\n]*#|data-label="#"/);
  assert.match(memberRecord, /className="sa-org-member-cell is-academic"[\s\S]*?student_number[\s\S]*?student\.current_term_program[\s\S]*?student\.current_term_year_level/);
  assert.match(memberRecord, /const accountLabel = getAccountStatusLabel\(student\.status\)[\s\S]*?className="sa-org-member-cell is-account"[\s\S]*?\{accountLabel\}/);
  assert.match(memberRecord, /className="sa-org-member-cell is-membership"[\s\S]*?is-current">Active[\s\S]*?handleRemoveMembership[\s\S]*?Remove membership/);
  assert.match(styles, /grid-template-columns:\s*minmax\(16rem, 1\.8fr\) minmax\(11rem, 1\.05fr\) minmax\(8rem, 0\.8fr\) minmax\(10rem, 1fr\)/);
  assert.match(styles, /\.sa-org-member-sequence\s*\{[^}]*color:\s*var\(--kandid-primary\)[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(styles, /\.sa-org-member-student\s*\{[^}]*grid-template-columns:\s*1\.5rem 2\.25rem minmax\(0, 1fr\)/s);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-org-member-row \.is-academic\s*\{\s*display: flex;\s*grid-column: 1 \/ -1/s);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-org-member-student\s*\{[^}]*grid-template-columns:\s*1\.25rem 2\.25rem minmax\(0, 1fr\)/s);
  assert.match(styles, /\.sa-org-member-row\.has-active-account \.sa-org-member-cell\.is-account \{ display: none; \}/);
  assert.match(styles, /\.sa-org-member-cell\.is-membership\s*\{\s*display: flex;\s*grid-column: 1 \/ -1;\s*align-items: center;\s*justify-content: space-between;/s);
  assert.match(memberRecord, /accountLabel === "Active"[\s\S]*has-active-account/);
  assert.match(memberRecord, /sa-org-member-remove-mobile[\s\S]*Remove <ArrowRight/);
  assert.match(styles, /\.sa-org-member-cell\.is-account::before,[\s\S]*\{\s*display: none;/);
  assert.match(styles, /\.sa-org-member-cell\.is-membership\s*\{[^}]*display: grid/s);
  assert.doesNotMatch(styles, /\.sa-org-member-registry\s*\{[^}]*overflow-x:\s*auto/s);
  assert.equal(Array.from({ length: 14 }, (_, index) => String(index + 1).padStart(2, "0")).at(-1), "14");
});

test("member record distinguishes loading, unavailable, verified empty, and populated states", () => {
  const memberRecord = page.slice(
    page.indexOf("{/* ORGANIZATION MEMBER RECORD */}"),
    page.indexOf("{/* CREATE / EDIT ORGANIZATION */}"),
  );

  assert.match(page, /setOrganizationMemberStatus\("loading"\)/);
  assert.match(page, /setOrganizationMemberStatus\("unavailable"\)/);
  assert.match(memberRecord, /Verifying current-term member records/);
  assert.match(memberRecord, /Membership record unavailable/);
  assert.match(memberRecord, /current-term member record could not be verified/);
  assert.match(memberRecord, /organizationMemberCount === 0/);
  assert.match(memberRecord, /No active members are recorded for this organization in the current academic term/);
  assert.match(memberRecord, /organizationStudents\.map\(\(student, index\)/);
  assert.doesNotMatch(memberRecord, /students\.length\s*\?\s*students\.length\s*:\s*0/);
});

test("new organizations follow Organization, Coverage, and Review steps", () => {
  assert.match(page, /\["Organization", "Coverage", "Review"\]/);
  assert.match(page, /Which organization is this\?/);
  assert.match(page, /Who does this organization represent\?/);
  assert.match(page, /Ready to add this organization\?/);
  assert.match(page, /data-progressive-next=/);
  assert.match(page, /setCreationStep\(2\)/);
  assert.match(page, /setCreationStep\(3\)/);
  assert.match(page, /Select at least one covered program before reviewing this organization/);
  assert.match(page, /document\.querySelector\('\[name="organization_program"\]'\)\?\.focus\(\)/);
  assert.match(page, /aria-label="Organization creation progress"/);
});

test("review is read-only and shared organization saving uses its trusted atomic operation", () => {
  assert.match(page, /sa-organizations-review-identity/);
  assert.match(page, /sa-organizations-review-detail/);
  assert.match(page, /selectedProgramIds\.includes\(String\(program\.id\)\)/);
  assert.match(page, /editingOrg \|\| creationStep === 1/);
  assert.match(page, /editingOrg \|\| creationStep === 2/);
  assert.match(page, /editingOrg \? "Save Changes"/);
  assert.match(page, /saveOrganizationConfiguration\(/);
  assert.match(styles, /\.sa-organizations-form\.is-creating \.sa-organizations-form-section/);
  assert.match(styles, /\.sa-organizations-progress/);
  assert.match(styles, /\.sa-organizations-review/);
});

test("organization form keeps actions outside the independently scrolling content", () => {
  assert.match(
    page,
    /<form[\s\S]*?<div className="sa-organizations-form-content">[\s\S]*?<\/div>\s*<footer className="sa-organizations-form-actions">[\s\S]*?<\/footer>\s*<\/form>/,
  );
  assert.match(styles, /\.sa-organizations-form-sheet\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
  assert.match(styles, /\.sa-organizations-form\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.sa-organizations-form-content\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(styles, /\.sa-organizations-form-actions\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?padding:[^;]*1\.25rem;/);
  assert.doesNotMatch(styles, /\.sa-organizations-form-actions\s*\{[^}]*position:\s*sticky/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.sa-organizations-form-actions \{ align-items: stretch; flex-direction: column-reverse; \}/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
});

test("Edit Organization shares Add's vertical form language without becoming a wizard", () => {
  assert.match(page, /className=\{`sa-organizations-form \$\{editingOrg \? "is-editing" : "is-creating"\}`\}/);
  assert.match(page, /editingOrg \? "Organization identity" : "Which organization is this\?"/);
  assert.match(page, /editingOrg \? "02 \/ Classification & membership" : "02 \/ Membership"/);
  assert.match(page, /formMembershipScope === "institution"[\s\S]*?Membership eligibility is institution-wide/);
  assert.match(page, /editingOrg \? "Classification & membership scope" : "Who does this organization represent\?"/);
  assert.doesNotMatch(page, /sa-organizations-form-section-head/);
  assert.match(page, /Organization Name[\s\S]*?Full organization name \/ description[\s\S]*?sa-organizations-logo-field/);
  assert.match(page, /Choose a new image only if you want to replace the current logo/);
  assert.match(page, /value=\{form\.logo_url\}/);
  assert.match(page, /editingOrg \? "Save Changes"/);
  assert.match(page, /className=\{`sa-organizations-form-section \$\{editingOrg \? "is-editing" : ""\}`\}/);
  assert.match(styles, /\.sa-organizations-form-section\.is-editing\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/);
  assert.match(styles, /\.sa-organizations-form\.is-editing \.sa-organizations-form-identity-grid/);
  assert.match(styles, /\.sa-organizations-form\.is-editing \.sa-organizations-step-focus h3/);
  assert.match(styles, /\.sa-organizations-logo-url input \{ text-overflow: ellipsis; \}/);
  assert.match(styles, /\.sa-organizations-form\.is-editing \.sa-organizations-form-identity-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});
