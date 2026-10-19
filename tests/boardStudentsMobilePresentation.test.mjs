import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/board/Students.jsx", "utf8");
const styles = readFileSync("src/index.css", "utf8");

test("Board mobile roster presents membership status in the identity metadata and keeps account status distinct", () => {
  assert.match(page, /className="board-student-mobile-record"/);
  assert.match(page, /className="board-student-mobile-index"[\s\S]*?\{rowIndex\}/);
  assert.match(page, /StudentAvatar student=\{student\} className="board-student-mobile-avatar"/);
  assert.match(page, /board-student-mobile-name[\s\S]*?studentDisplayName\(student\)/);
  assert.match(page, /student\.student_number[\s\S]*?student\.program[\s\S]*?Year \$\{student\.year_level\}[\s\S]*?membershipLabel/);
  assert.match(page, /statusKey !== "active"[\s\S]*?accountLabel/);
  assert.match(page, /board-student-mobile-email/);
  assert.match(page, /viewMode === "removed" && student\.removal_reason[\s\S]*?Removal reason:/);
});

test("Board mobile menu preserves existing edit, organization-scoped removal, and restore actions", () => {
  const menu = page.slice(page.indexOf("function BoardStudentMobileActions"), page.indexOf("function BoardStudents()"));
  assert.match(menu, /aria-haspopup="menu"[\s\S]*?aria-expanded=\{open\}[\s\S]*?aria-controls=\{menuId\}/);
  assert.match(menu, /MoreHorizontal size=\{20\} aria-hidden="true"/);
  assert.match(menu, /onRestore\(\)[\s\S]*?Restore membership/);
  assert.match(menu, /onEdit\(\)[\s\S]*?Edit student/);
  assert.match(menu, /onRemove\(\)[\s\S]*?Remove membership/);
  assert.match(menu, /Escape[\s\S]*?triggerRef\.current\?\.focus\(\)/);
  assert.match(menu, /ArrowDown[\s\S]*?ArrowUp[\s\S]*?Home[\s\S]*?End/);
  assert.match(page, /onEdit=\{\(\) => openEditStudent\(student\)\}/);
  assert.match(page, /onRemove=\{\(\) => handleRemoveMembership\(student\)\}/);
  assert.match(page, /onRestore=\{\(\) => handleRestoreMembership\(student\)\}/);
});

test("mobile roster uses the responsive four-part grid and leaves the desktop roster visible outside the mobile breakpoint", () => {
  assert.match(styles, /\.board-student-desktop-record \{ display: contents; \}/);
  assert.match(styles, /\.board-student-mobile-record \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.board-student-desktop-record \{ display: none; \}[\s\S]*?grid-template-columns: 1\.35rem 2\.05rem minmax\(0, 1fr\) 1\.25rem/);
  assert.match(styles, /\.board-student-mobile-actions-trigger[\s\S]*?width: 2\.5rem;[\s\S]*?height: 2\.5rem/);
  assert.match(styles, /\.board-student-mobile-actions-menu button:focus-visible/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?grid-template-columns: 1\.2rem 1\.9rem minmax\(0, 1fr\) 1\.25rem/);
});

test("Board keeps Add Student and Import CSV directly available as balanced mobile actions", () => {
  assert.match(page, /to="\/board\/csv-import" className="board-students-action is-import"[\s\S]*?Import CSV/);
  assert.match(page, /<Upload size=\{15\} aria-hidden="true" \/>/);
  assert.match(page, /className="board-students-action is-create"[\s\S]*?Add Student/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.board-students-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.board-students-action\.is-create \{[\s\S]*?background: var\(--kandid-app-orange\)/);
  assert.match(styles, /\.board-students-action \{[\s\S]*?background: transparent/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.board-students-actions \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.board-students-action\.is-create \{ grid-column: 1; grid-row: 1; \}[\s\S]*?\.board-students-action\.is-import \{ grid-column: 2; grid-row: 1; \}/);
});
