import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getOrganizationDeletionAdvisorySummary,
  normalizeTrustedOrganizationDependencies,
  normalizeOrganizationDeletionAdvisory,
  ORGANIZATION_DELETION_REVIEW_CATEGORIES,
  visibleOrganizationDeletionDependencies,
} from "../src/utils/organizationDeletionReview.js";

const organizationsCss = readFileSync(new URL("../src/pages/superadmin/Organizations.css", import.meta.url), "utf8");
const organizationsJsx = readFileSync(new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url), "utf8");
const deletionState = readFileSync(new URL("../src/utils/organizationDeletionState.js", import.meta.url), "utf8");
const deletionService = readFileSync(new URL("../src/utils/organizationDeletion.js", import.meta.url), "utf8");

test("advisory review includes real nonzero dependency counts and omits verified zeros", () => {
  const categories = normalizeOrganizationDeletionAdvisory({
    ...Object.fromEntries(ORGANIZATION_DELETION_REVIEW_CATEGORIES.map(({ key }) => [key, { count: 0 }])),
    student_memberships: { count: 21 },
    officer_history: { count: 6 },
  });

  const visible = visibleOrganizationDeletionDependencies(categories);
  assert.deepEqual(visible.map(({ key, count }) => [key, count]), [
    ["student_memberships", 21],
    ["officer_history", 6],
  ]);
  assert.equal(getOrganizationDeletionAdvisorySummary(categories).recordCount, 27);
});

test("failed or absent advisory queries remain unverified instead of becoming zero", () => {
  const categories = normalizeOrganizationDeletionAdvisory({
    student_memberships: { error: true },
    program_coverage: { count: null },
  });

  assert.equal(categories.find(({ key }) => key === "student_memberships").status, "unverified");
  assert.equal(categories.find(({ key }) => key === "student_memberships").count, null);
  assert.equal(categories.find(({ key }) => key === "program_coverage").status, "unverified");
  assert.equal(categories.find(({ key }) => key === "program_coverage").count, null);
  assert.equal(getOrganizationDeletionAdvisorySummary(categories).unverifiedCount, ORGANIZATION_DELETION_REVIEW_CATEGORIES.length);
});

test("review contract includes the known deletion dependencies and preserves historical classification", () => {
  assert.deepEqual(ORGANIZATION_DELETION_REVIEW_CATEGORIES.map(({ key }) => key), [
    "student_memberships",
    "current_term_participation",
    "historical_term_participation",
    "program_coverage",
    "election_history",
    "officer_history",
    "board_assignments",
    "partylists",
    "prepared_officers",
    "leadership_releases",
    "campaign_snapshots",
    "officer_publications",
  ]);
  for (const key of ["election_history", "officer_history", "leadership_releases", "campaign_snapshots", "officer_publications"]) {
    assert.equal(ORGANIZATION_DELETION_REVIEW_CATEGORIES.find((category) => category.key === key).kind, "history");
  }
  const links = ORGANIZATION_DELETION_REVIEW_CATEGORIES.find(({ key }) => key === "student_memberships");
  assert.equal(links.label, "Organization links");
  assert.match(links.explanation, /including historical relationships/i);
  assert.match(links.explanation, /not the current-term member count/i);
  assert.equal(links.unit, "links");
  assert.equal(ORGANIZATION_DELETION_REVIEW_CATEGORIES.find(({ key }) => key === "current_term_participation").kind, "manageable");
  assert.equal(ORGANIZATION_DELETION_REVIEW_CATEGORIES.find(({ key }) => key === "historical_term_participation").kind, "history");
});

test("trusted blocked dependencies preserve backend classifications and resolutions", () => {
  const [membership, history, unknown] = normalizeTrustedOrganizationDependencies([
    { key: "student_memberships", label: "Student memberships", count: 4, classification: "administratively_resolvable", resolution: "Manage membership." },
    { key: "election_history", label: "Elections and related history", count: 2, classification: "historical_preserved", resolution: "Preserve election history." },
    { key: "system_dependency", label: "Unclassified organization dependency", count: 1, classification: "system_dependency", resolution: "Review this relationship." },
  ]);

  assert.equal(membership.kind, "manageable");
  assert.equal(membership.label, "Organization links");
  assert.match(membership.explanation, /not the current-term member count/i);
  assert.equal(history.kind, "history");
  assert.equal(history.count, 2);
  assert.equal(unknown.kind, "unverified");
  assert.equal(unknown.destination, null);
  assert.equal(unknown.explanation, "Review this relationship.");
});

test("trusted term participation categories distinguish active from historical records", () => {
  const [active, historical] = normalizeTrustedOrganizationDependencies([
    { key: "current_term_participation", count: 3, classification: "administratively_resolvable", resolution: "Active term participation." },
    { key: "historical_term_participation", count: 8, classification: "historical_preserved", resolution: "Historical term participation." },
  ]);
  assert.equal(active.label, "Current-term active participation");
  assert.equal(active.kind, "manageable");
  assert.equal(active.count, 3);
  assert.equal(historical.label, "Historical / removed term participation");
  assert.equal(historical.kind, "history");
  assert.equal(historical.count, 8);
});

test("deletion readiness separates current-term members from organization links", () => {
  const links = normalizeOrganizationDeletionAdvisory({
    student_memberships: { count: 21 },
  }).find(({ key }) => key === "student_memberships");
  assert.equal(links.count, 21);
  assert.equal(links.label, "Organization links");
  assert.equal(links.sourceKey, "student_memberships");
  assert.doesNotMatch(links.label, /member/i);
  assert.match(organizationsJsx, /getCurrentOrganizationMemberCount\(organization\.id\)/);
  assert.match(organizationsJsx, /Current-term members/);
  assert.match(organizationsJsx, /currentTermMemberCount === null[\s\S]*?could not be verified/);
  assert.match(organizationsJsx, /current-term membership is calculated separately/i);
});

test("full review groups manageable records, preserved history, and verification requirements", () => {
  assert.match(organizationsJsx, /label: "Needs attention"/);
  assert.match(organizationsJsx, /label: "Preserved history"/);
  assert.match(organizationsJsx, /label: "Verification required"/);
  assert.match(organizationsJsx, /Historical record · no direct removal here/);
  assert.match(organizationsJsx, /View current-term members/);
  assert.match(organizationsJsx, /Manage coverage/);
  assert.match(organizationsJsx, /Manage Board access/);
  assert.match(organizationsJsx, /View partylists/);
  assert.match(organizationsJsx, /Additional deletion requirements/);
});

test("unavailable verification stays unknown and permanent deletion remains gated", () => {
  assert.match(organizationsJsx, /Kandid cannot yet verify every record required for safe permanent deletion/);
  assert.match(organizationsJsx, /unavailable information is never assumed to be zero/);
  assert.match(organizationsJsx, /Kandid could not verify this count yet\. It remains unknown, not zero/);
  assert.match(organizationsJsx, /trustedStatus !== "ready" \|\| deletionReviewBusy/);
  assert.match(organizationsJsx, /Not available/);
  assert.match(organizationsJsx, /Delete permanently/);
  assert.match(deletionState, /ORGANIZATION_DELETION_CONTRACT_ENABLED = false/);
  assert.match(deletionService, /if \(!ORGANIZATION_DELETION_CONTRACT_ENABLED\)[\s\S]*?return \{ status: "unavailable"[\s\S]*?supabase\.rpc\("kandid_delete_organization"/);
});

test("deletion review surfaces own a readable palette outside the themed portal", () => {
  const paletteRule = organizationsCss.match(/\.sa-deletion-entry,\s*\.sa-deletion-review\s*\{([^}]*)\}/)?.[1];
  assert.ok(paletteRule, "both review surfaces should define their own Kandid palette");
  for (const [token, value] of Object.entries({
    "--kandid-app-paper": "#f8f6f1",
    "--kandid-app-ink": "#101114",
    "--kandid-app-muted": "#5b5e66",
    "--kandid-app-orange": "#c14425",
  })) {
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(paletteRule, new RegExp(`${token}:\\s*${escapedValue}`, "i"));
  }
  assert.match(organizationsCss, /\.sa-deletion-entry\s*\{[^}]*background:\s*var\(--kandid-app-paper\);[^}]*color:\s*var\(--kandid-app-ink\);/s);
  assert.match(organizationsCss, /\.sa-deletion-entry-review\s*\{[^}]*background:\s*#f4512c;[^}]*color:\s*var\(--kandid-app-ink\);/s);
  assert.match(organizationsCss, /\.sa-deletion-entry\s+:is\(button, a\):focus-visible,[\s\S]*?outline:\s*2px solid #b83a20;/);

  const surfaceRule = organizationsCss.match(/\.sa-deletion-entry,\s*\.sa-deletion-review\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(surfaceRule, /\b(?:opacity|filter|mix-blend-mode)\s*:/);
  assert.doesNotMatch(organizationsCss, /\.sa-deletion-(?:entry|review)\.is-(?:unavailable|error|blocked)\s*\{[^}]*\bopacity\s*:/s);

  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const foreground of ["#101114", "#5b5e66", "#c14425"]) {
    assert.ok(contrast(foreground, "#f8f6f1") >= 4.5, `${foreground} should meet normal-text contrast on paper`);
  }
  assert.ok(contrast("#101114", "#f4512c") >= 4.5, "primary-action text should remain readable on orange");
});

test("advisory and trusted-readiness states never style Review Related Records as unavailable", () => {
  const allVerifiedZero = Object.fromEntries(ORGANIZATION_DELETION_REVIEW_CATEGORIES.map(({ key }) => [key, { count: 0 }]));
  const cases = [
    { name: "advisory counts loaded", advisory: { ...allVerifiedZero, student_memberships: { count: 2 } }, trusted: "blocked", expectedUnverified: false },
    { name: "some dependencies unverified", advisory: { ...allVerifiedZero, student_memberships: { error: true } }, trusted: "unavailable", expectedUnverified: true },
    { name: "unexpected advisory error", advisory: Object.fromEntries(ORGANIZATION_DELETION_REVIEW_CATEGORIES.map(({ key }) => [key, { error: true }])), trusted: "error", expectedUnverified: true },
    { name: "zero advisory dependencies with unavailable readiness", advisory: allVerifiedZero, trusted: "unavailable", expectedUnverified: false },
  ];
  for (const scenario of cases) {
    assert.ok(["blocked", "unavailable", "error"].includes(scenario.trusted));
    const summary = getOrganizationDeletionAdvisorySummary(normalizeOrganizationDeletionAdvisory(scenario.advisory));
    assert.equal(summary.unverifiedCount > 0, scenario.expectedUnverified, scenario.name);
  }

  // The advisory/readiness variation has no state class on either surface; only
  // the action's own loading condition can apply its disabled appearance.
  assert.doesNotMatch(organizationsJsx, /className=\{`sa-deletion-entry[^`]*trustedStatus/);
  assert.doesNotMatch(organizationsCss, /\.sa-deletion-entry(?:\.is-[\w-]+|\[data-[^]]+\])\s*\{/);
  const reviewButton = organizationsJsx.match(/<button\s+type="button"\s+className="sa-deletion-entry-review"\s+disabled=\{([^}]+)\}/)?.[1];
  assert.equal(reviewButton, "deletionEntry.loading || !deletionEntry.review");
  assert.doesNotMatch(reviewButton, /trustedStatus|readiness/);
  assert.match(organizationsJsx, /className="sa-deletion-review-delete"\s+disabled=\{trustedStatus !== "ready" \|\| deletionReviewBusy\}/);
  assert.match(organizationsCss, /\.sa-deletion-entry-review:disabled\s*,\s*\.sa-deletion-review-action:disabled\s*\{[^}]*opacity:\s*0\.55;/);
});
