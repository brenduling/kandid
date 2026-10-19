import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/superadmin/Students.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/pages/superadmin/Students.css", import.meta.url), "utf8");

test("Super Admin Students places the live matching count first in a four-metric register", () => {
  const summary = page.slice(page.indexOf('className="sa-students-summary"'), page.indexOf('className="sa-students-registry"'));
  const header = page.slice(page.indexOf("<SuperAdminPageHeader"), page.indexOf("{!loadingStudents"));

  assert.doesNotMatch(header, /Registry desk|matching records|totalStudents/);
  assert.match(header, /Add student/);
  assert.match(summary, /<span>Matching records<\/span>[\s\S]*?<strong>\{totalStudents\}<\/strong>[\s\S]*?<small>Current search and filters<\/small>/);
  assert.deepEqual([...summary.matchAll(/<span>(Matching records|Active|Pending|Disabled)<\/span>/g)].map((match) => match[1]), ["Matching records", "Active", "Pending", "Disabled"]);
  assert.match(summary, /visibleStatusCounts\.active/);
  assert.match(summary, /visibleStatusCounts\.pending/);
  assert.match(summary, /visibleStatusCounts\.disabled/);
  assert.match(styles, /\.sa-students-summary\s*\{\s*display: grid;\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
});

test("Student directory uses the editorial heading, compact filters, and no table column header", () => {
  const directory = page.slice(page.indexOf('className="sa-students-registry"'), page.indexOf("{/* CREATE / EDIT FORM */}"));

  assert.match(directory, /sa-students-eyebrow">Student directory/);
  assert.match(directory, /id="student-registry-heading">Student records/);
  assert.doesNotMatch(directory, /Directory \/ 01|<table|<thead|<th\b/);
  assert.match(directory, /<span>Search students<\/span>[\s\S]*?placeholder="Student number, name, or email"/);
  assert.match(directory, /className="sa-students-control"[\s\S]*?Organization/);
  assert.match(directory, /className="sa-students-status-filter"[\s\S]*?aria-pressed=\{statusFilter === option\.value\}/);
  assert.doesNotMatch(directory, /<span>Status<\/span>/);
  assert.match(directory, /className="sa-students-sort"[\s\S]*?<span>Sort<\/span>[\s\S]*?value=\{sortBy\}/);
  assert.match(styles, /\.sa-students-toolbar\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 2fr\) minmax\(11rem, 0\.72fr\);/);
  assert.match(styles, /\.sa-students-status-filter\s*\{[^}]*justify-content: space-between/s);
  assert.doesNotMatch(styles, /\.sa-students-table/);
});

test("Student records prioritize identity and retain memberships, access states, and existing actions", () => {
  const directory = page.slice(page.indexOf('className="sa-students-records"'), page.indexOf('aria-label="Student directory pagination"'));

  assert.match(directory, /role="list"[\s\S]*?role="listitem"/);
  assert.match(directory, /sa-students-index[\s\S]*?padStart\(2, "0"\)/);
  assert.match(directory, /sa-students-identity-meta[\s\S]*?student\.student_number[\s\S]*?student\.program[\s\S]*?student\.year_level/);
  assert.match(directory, /student\.email \? <small>\{student\.email\}<\/small>/);
  assert.match(directory, /sa-students-membership-list[\s\S]*?studentOrganizations\[0\]\.name[\s\S]*?more membership/);
  assert.match(directory, /sa-students-unassigned">No organization/);
  assert.match(directory, /sa-students-state-mark is-\$\{studentStatus\}/);
  assert.match(directory, /studentStatus === "active"[\s\S]*?Access enabled[\s\S]*?Access restricted[\s\S]*?Review pending/);
  assert.match(directory, /onClick=\{\(\) => openEditForm\(student\)\}/);
  assert.match(directory, /onClick=\{\(\) => handleDelete\(student\.id\)\}/);
  assert.match(styles, /\.sa-students-record\s*\{\s*position: relative;\s*display: grid;/);
  assert.match(styles, /\.sa-students-record::after/);
});

test("mobile student rows form a compact three-line identity, academic, and contact registry entry", () => {
  const mobileStart = page.indexOf('className="sa-students-mobile-record"');
  const mobileRecord = page.slice(mobileStart, page.indexOf("</article>", mobileStart));

  assert.match(mobileRecord, /sa-students-index[\s\S]*?padStart\(2, "0"\)[\s\S]*?className="sa-students-avatar"/);
  assert.match(mobileRecord, /className="sa-students-mobile-content"[\s\S]*?<strong>\{studentName\}<\/strong>[\s\S]*?sa-students-identity-meta[\s\S]*?student.student_number[\s\S]*?student.program[\s\S]*?student.year_level[\s\S]*?sa-students-mobile-status[\s\S]*?\{studentStatus\}[\s\S]*?sa-students-mobile-email/);
  assert.match(mobileRecord, /className="sa-students-mobile-email" title=\{student.email \|\| "Email not recorded"\}[\s\S]*?student.email \|\| "Email not recorded"/);
  assert.doesNotMatch(mobileRecord, /studentOrganizations|membership/i);
  assert.doesNotMatch(mobileRecord, /sa-students-mobile-trailing|className="sa-students-state"/);
  assert.match(mobileRecord, /sa-students-state-mark is-\$\{studentStatus\}[\s\S]*?<strong>\{studentStatus\}<\/strong>/);
  assert.match(styles, /\.sa-students-mobile-record \{\s*position: relative;\s*display: grid;\s*grid-template-columns: 1\.35rem 2\.05rem minmax\(0, 1fr\) 1\.25rem;[\s\S]*?grid-template-rows: min-content min-content min-content;/);
  assert.match(styles, /\.sa-students-mobile-status \{[\s\S]*?display: inline-flex;[\s\S]*?gap: 0\.24rem;[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.sa-students-mobile-actions-slot \{[\s\S]*?grid-column: 4;[\s\S]*?grid-row: 1;[\s\S]*?width: 1\.25rem;[\s\S]*?height: 0;/);
  assert.match(styles, /\.sa-students-mobile-actions-slot \.sa-students-mobile-actions-trigger \{[\s\S]*?position: absolute;[\s\S]*?right: -0\.625rem;[\s\S]*?width: 2\.5rem;[\s\S]*?height: 2\.5rem;/);
  assert.match(styles, /padding-right: 0\.9rem;/);
  assert.match(styles, /\.sa-students-mobile-email \{\s*display: block;\s*overflow: hidden;[\s\S]*?text-overflow: ellipsis;\s*white-space: nowrap;/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students-record \{ display: block; padding: 0\.56rem 0 0\.62rem; \}/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.sa-students-mobile-record \{ grid-template-columns: 1\.2rem 1\.9rem minmax\(0, 1fr\) 1\.25rem; column-gap: 0\.5rem; \}/);
});

test("Pagination stays with directory navigation rather than the directory heading", () => {
  const directory = page.slice(page.indexOf('className="sa-students-registry"'), page.indexOf("{/* CREATE / EDIT FORM */}"));

  assert.doesNotMatch(directory.slice(0, directory.indexOf('className="sa-students-toolbar"')), /Page \{page\} of/);
  assert.match(directory, /className="sa-students-pager"[\s\S]*?Showing \{pageStart\}-\{pageEnd\} students[\s\S]*?Page \{page\} of \{totalPages\}/);
  assert.match(directory, /disabled=\{page <= 1\}[\s\S]*?setPage\(\(current\) => Math\.max\(1, current - 1\)\)/);
  assert.match(directory, /disabled=\{page >= totalPages\}[\s\S]*?setPage\(\(current\) => Math\.min\(totalPages, current \+ 1\)\)/);
});

test("responsive layouts use a compact two-by-two summary on mobile and reflow records without horizontal tables", () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.sa-students-summary \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students-summary \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}[\s\S]*?\.sa-students-summary-item:nth-child\(odd\) \{ border-left: 0; \}[\s\S]*?\.sa-students-summary-item:nth-child\(n \+ 3\) \{ border-top: 1px solid/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students-mobile-record\s*\{\s*position: relative;[\s\S]*?grid-template-columns: 1\.35rem 2\.05rem minmax\(0, 1fr\) 1\.25rem;/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.sa-students-summary-item > small \{ display: none; \}/);
  assert.match(styles, /\.sa-students-identity-meta\s*\{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.sa-students-identity small\s*\{[^}]*overflow-wrap: anywhere/s);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
});

test("mobile controls use the established full-width action and a consistent search-to-sort rhythm", () => {
  const toolbar = page.slice(page.indexOf('className="sa-students-toolbar"'), page.indexOf('className="sa-students-records"'));
  const statusDefinitions = page.slice(page.indexOf("const statusOptions = ["), page.indexOf("function renderRegistrationProgress"));

  assert.match(page, /className="sa-students-add"[^>]*>[\s\S]*?Add student/);
  assert.match(toolbar, /<span>Search students<\/span>/);
  assert.match(toolbar, /<span>Organization<\/span>/);
  assert.match(toolbar, /<span>Sort<\/span>/);
  assert.deepEqual([...statusDefinitions.matchAll(/label: "(All|Active|Pending|Disabled)"/g)].map((match) => match[1]), ["All", "Active", "Pending", "Disabled"]);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students \.sa-page-header-actions,[\s\S]*?\.sa-students \.sa-students-add,[\s\S]*?\.sa-students \.sa-students-import \{ width: 100%; \}/);
  assert.match(styles, /\.sa-students-search > span,[\s\S]*?\.sa-students-control > span,[\s\S]*?font-size: 0\.61rem;[\s\S]*?font-weight: 850;[\s\S]*?text-transform: uppercase;/);
  assert.match(styles, /\.sa-students-status-filter button \{[^}]*text-transform: uppercase/s);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.sa-students-status-options > div \{ flex-wrap: nowrap;/);
});
