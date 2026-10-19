import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/superadmin/Students.jsx", "utf8");
const styles = readFileSync("src/pages/superadmin/Students.css", "utf8");
const routes = readFileSync("src/App.jsx", "utf8");
const importPage = readFileSync("src/pages/superadmin/CSVImport.jsx", "utf8");
const importClient = readFileSync("src/utils/superAdminMasterlistImport.js", "utf8");

test("Super Admin Students exposes CSV Import before the existing primary Add Student action", () => {
  const actions = page.slice(page.indexOf('className="sa-students-header-actions"'), page.indexOf("</SuperAdminPageHeader>"));
  assert.match(actions, /<Link className="sa-students-import" to="\/super-admin\/csv-import"[\s\S]*?Import CSV[\s\S]*?<button className="sa-students-add"[\s\S]*?Add student/);
  assert.match(actions, /<Upload size=\{16\} aria-hidden="true" \/>/);
  assert.match(actions, /openCreateForm/);
});

test("Import CSV reuses the existing Super Admin masterlist route, workflow, and trusted contract", () => {
  assert.match(routes, /path="csv-import"[\s\S]*?element=\{<CSVImport \/>\}/);
  assert.match(importPage, /createMasterlistImport\(/);
  assert.match(importPage, /navigate\(`\/super-admin\/masterlist\/review\/\$\{data\.import\.id\}`\)/);
  assert.match(importClient, /const MASTERLIST_FUNCTION = "super-admin-masterlist-import"/);
  assert.match(importClient, /action: "create_import"[\s\S]*?academic_term_id[\s\S]*?file_name[\s\S]*?rows/);
});

test("Import and Add actions share compact header geometry with a primary-only orange treatment", () => {
  assert.match(styles, /\.sa-students-header-actions \{[\s\S]*?display: flex;[\s\S]*?justify-content: flex-end;[\s\S]*?gap: 0\.55rem/);
  assert.match(styles, /\.sa-students-import \{[\s\S]*?border: 1px solid var\(--kandid-app-ink[\s\S]*?background: transparent/);
  assert.match(styles, /\.sa-students-add \{[\s\S]*?background: var\(--kandid-app-orange/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.sa-students-header-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.sa-students-header-actions \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
