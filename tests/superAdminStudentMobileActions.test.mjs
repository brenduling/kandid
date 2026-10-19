import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/superadmin/Students.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/pages/superadmin/Students.css", import.meta.url), "utf8");

test("student mobile action menu exposes accessible trigger, menu items, and existing handlers", () => {
  const menu = page.slice(page.indexOf("function StudentMobileActions"), page.indexOf("function Students()"));

  assert.match(menu, /aria-label="Student actions"/);
  assert.match(menu, /aria-haspopup="menu"[\s\S]*?aria-expanded=\{open\}[\s\S]*?aria-controls=\{menuId\}/);
  assert.match(menu, /MoreHorizontal size=\{20\} aria-hidden="true"/);
  assert.match(menu, /role="menu"[\s\S]*?role="menuitem"[\s\S]*?Edit student[\s\S]*?role="menuitem"[\s\S]*?Delete student/);
  assert.match(menu, /onEdit\(\)/);
  assert.match(menu, /onDelete\(\)/);
  assert.match(menu, /event\.key !== "Escape"[\s\S]*?setOpen\(false\)[\s\S]*?triggerRef\.current\?\.focus\(\)/);
  assert.match(menu, /handlePointerDown[\s\S]*?rootRef\.current\?\.contains\(event\.target\)[\s\S]*?setOpen\(false\)/);
  assert.match(menu, /ArrowDown[\s\S]*?ArrowUp[\s\S]*?Home[\s\S]*?End/);
});

test("mobile menu replaces permanent row actions only at the mobile breakpoint", () => {
  assert.match(styles, /\.sa-students-mobile-actions \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students-mobile-record \{[\s\S]*?grid-template-columns: 1\.35rem 2\.05rem minmax\(0, 1fr\) 1\.25rem;[\s\S]*?\}[\s\S]*?\.sa-students-mobile-actions-slot \.sa-students-mobile-actions \{ display: block; position: relative; width: 100%; height: 0; \}[\s\S]*?\.sa-students-action-list \{ display: none; \}/);
  assert.match(styles, /\.sa-students-mobile-actions-trigger \{[\s\S]*?background: transparent;/);
  assert.match(styles, /\.sa-students-mobile-actions-slot \{[\s\S]*?grid-column: 4;[\s\S]*?grid-row: 1;[\s\S]*?width: 1\.25rem;[\s\S]*?height: 0;/);
  assert.match(styles, /\.sa-students-mobile-actions-slot \.sa-students-mobile-actions-trigger \{[\s\S]*?position: absolute;[\s\S]*?right: -0\.625rem;[\s\S]*?width: 2\.5rem;[\s\S]*?height: 2\.5rem;/);
  assert.match(styles, /\.sa-students-mobile-actions-slot \.sa-students-mobile-actions-trigger \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
  assert.match(styles, /\.sa-students-mobile-record \{[\s\S]*?padding-right: 0\.9rem;/);
  assert.doesNotMatch(styles, /\.sa-students-mobile-actions-slot \{\s*position: absolute;[^}]*right: -/);
  assert.match(styles, /\.sa-students-mobile-actions-menu \{[\s\S]*?position: absolute;[\s\S]*?z-index: 20;/);
  assert.match(styles, /\.sa-students-mobile-actions-trigger:focus-visible,[\s\S]*?\.sa-students-mobile-actions-menu button:focus-visible/);
});

test("Super Admin mobile roster geometry matches the Board mobile identity rhythm", () => {
  assert.match(styles, /\.sa-students-record \{ display: block; padding: 0\.56rem 0 0\.62rem; \}/);
  assert.match(styles, /\.sa-students-mobile-record \{[\s\S]*?grid-template-columns: 1\.35rem 2\.05rem minmax\(0, 1fr\) 1\.25rem;[\s\S]*?column-gap: 0\.58rem/);
  assert.match(styles, /\.sa-students-mobile-record > \.sa-students-index \{[\s\S]*?padding-top: 0\.06rem; font-size: 0\.78rem; line-height: 1\.35/);
  assert.match(styles, /\.sa-students-mobile-content > strong \{[\s\S]*?font-size: 0\.84rem;[\s\S]*?line-height: 1\.28/);
  assert.match(styles, /\.sa-students-mobile-content \.sa-students-identity-meta \{[\s\S]*?font-size: 0\.7rem;[\s\S]*?line-height: 1\.35/);
  assert.match(styles, /\.sa-students-mobile-email \{[\s\S]*?font-size: 0\.68rem;[\s\S]*?line-height: 1\.32/);
  assert.match(styles, /\.sa-students-mobile-record \{ grid-template-columns: 1\.2rem 1\.9rem minmax\(0, 1fr\) 1\.25rem; column-gap: 0\.5rem; \}/);
  assert.match(styles, /\.sa-students-mobile-content \.sa-students-identity-meta \{ font-size: 0\.68rem; \}/);
  assert.match(page, /student\.student_number[\s\S]*?student\.program[\s\S]*?Year \$\{student\.year_level\}[\s\S]*?studentStatus/);
  assert.doesNotMatch(page, /sa-students-mobile-record[\s\S]*?student_organizations/);
});
