import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const header = await readFile(new URL("../src/components/SuperAdminPageHeader.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/components/SuperAdminPageHeader.css", import.meta.url), "utf8");

test("shared Super Admin header follows the Board masthead composition", () => {
  assert.match(header, /Super Admin \/ \{section\}/);
  assert.match(header, /sa-page-header-eyebrow-rule/);
  assert.match(header, /<h1 className="sa-page-header-title">\{title\}<\/h1>/);
  assert.match(header, /\{description \? <p/);
  assert.match(header, /\{context \? <div/);
  assert.match(header, /\{actions \? <div/);
  assert.match(css, /grid-template-areas:[\s\S]*"title actions"[\s\S]*"description \."/);
  assert.match(css, /border-bottom: 2px solid var\(--sa-header-ink\)/);
  assert.match(css, /background: var\(--sa-header-rule\)/);
  assert.match(css, /font-family: "Source Serif 4", Georgia, serif/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /"eyebrow"[\s\S]*"title"[\s\S]*"description"[\s\S]*"actions"/);
});

test("all routed Super Admin workspaces use the shared header, except the dedicated full-screen kiosk flow", async () => {
  const routeFiles = [
    "superadmin/Dashboard.jsx", "superadmin/Organizations.jsx", "superadmin/Students.jsx",
    "superadmin/CSVImport.jsx", "superadmin/MasterlistReview.jsx", "superadmin/Elections.jsx",
    "superadmin/Positions.jsx", "superadmin/Candidates.jsx", "superadmin/Officers.jsx",
    "superadmin/Partylists.jsx", "superadmin/EligibilityRules.jsx", "superadmin/VotingMonitor.jsx",
    "superadmin/Results.jsx", "superadmin/BlockchainVerification.jsx", "superadmin/Reports.jsx",
    "superadmin/AuditLogs.jsx", "superadmin/UsersRoles.jsx", "superadmin/ArchivePage.jsx",
    "superadmin/SystemSettings.jsx", "shared/SearchPage.jsx", "shared/NotificationsPage.jsx",
    "shared/Profile.jsx",
  ];

  for (const file of routeFiles) {
    const source = file === "superadmin/Candidates.jsx"
      ? await readFile(new URL("../src/components/CandidateManagement.jsx", import.meta.url), "utf8")
      : await readFile(new URL(`../src/pages/${file}`, import.meta.url), "utf8");
    assert.match(source, /SuperAdminPageHeader/, `${file} should use the shared Super Admin header`);
  }

  assert.match(app, /path="kiosk"[\s\S]*?<KioskVoting \/>/);
});

test("dashboard uses the compact Dashboard header; shared pages scope it to Super Admin", async () => {
  const dashboard = await readFile(new URL("../src/pages/superadmin/Dashboard.jsx", import.meta.url), "utf8");
  const search = await readFile(new URL("../src/pages/shared/SearchPage.jsx", import.meta.url), "utf8");
  const notifications = await readFile(new URL("../src/pages/shared/NotificationsPage.jsx", import.meta.url), "utf8");
  const profile = await readFile(new URL("../src/pages/shared/Profile.jsx", import.meta.url), "utf8");
  assert.match(dashboard, /title="Dashboard"/);
  assert.doesNotMatch(dashboard, /Election Command Center/);
  assert.doesNotMatch(dashboard, /variant="expanded"/);
  assert.match(dashboard, /System records, election operations, and activity across Kandid/);
  assert.match(search, /activeUser\?\.role === "super_admin"/);
  assert.match(notifications, /activeUser\?\.role === "super_admin"/);
  assert.match(profile, /isSuperAdmin/);
});
