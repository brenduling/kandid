export const ORGANIZATION_DELETION_REVIEW_CATEGORIES = [
  {
    key: "student_memberships",
    label: "Organization links",
    table: "student_organizations",
    kind: "manageable",
    destination: "members",
    explanation: "Student relationships associated with this organization, including historical relationships. These are not the current-term member count.",
    unit: "links",
  },
  { key: "current_term_participation", label: "Current-term active participation", table: "student_organization_terms", kind: "manageable", destination: "members", explanation: "Active student participation in an academic term that is currently active. This is distinct from structural organization links.", unit: "records" },
  { key: "historical_term_participation", label: "Historical / removed term participation", table: "student_organization_terms", kind: "history", destination: null, explanation: "Removed participation and records from non-current terms remain part of the preserved history.", unit: "records" },
  { key: "program_coverage", label: "Program coverage", table: "organization_programs", kind: "manageable", destination: "coverage", explanation: "Programs assigned to this organization. Coverage is managed separately from current-term participation.", unit: "programs" },
  { key: "election_history", label: "Election history", table: "elections", kind: "history", destination: "/super-admin/elections", explanation: "Elections belong to this organization and form part of its preserved election history.", unit: "elections" },
  { key: "officer_history", label: "Officer history", table: "officers", kind: "history", destination: "/super-admin/officers", explanation: "Officer records preserve the organization's leadership history.", unit: "records" },
  { key: "board_assignments", label: "Board assignments", table: "admin_users", kind: "manageable", destination: "/super-admin/users-roles", explanation: "Administrator accounts currently assigned to this organization.", unit: "accounts" },
  { key: "partylists", label: "Partylists", table: "partylists", kind: "manageable", destination: "/super-admin/partylists", explanation: "Partylists currently associated with this organization.", unit: "partylists" },
  { key: "prepared_officers", label: "Prepared officer rosters", table: "officer_new_roster", kind: "manageable", destination: "/super-admin/officers", explanation: "Officer entries prepared for a future leadership release.", unit: "entries" },
  { key: "leadership_releases", label: "Leadership releases", table: "officer_leadership_releases", kind: "history", destination: "/super-admin/officers", explanation: "Release records document leadership transitions and remain part of the historical record.", unit: "releases" },
  { key: "campaign_snapshots", label: "Campaign snapshots", table: "election_campaign_snapshots", kind: "history", destination: "/super-admin/elections", explanation: "Campaign snapshots preserve election-specific records.", unit: "snapshots" },
  { key: "officer_publications", label: "Officer publications", table: "election_officer_publications", kind: "history", destination: "/super-admin/officers", explanation: "Officer publications preserve previously published leadership information.", unit: "publications" },
];

export function normalizeOrganizationDeletionAdvisory(results = {}) {
  return ORGANIZATION_DELETION_REVIEW_CATEGORIES.map((category) => {
    const result = results[category.key];
    const count = result?.count;
    const verified = result?.error !== true && Number.isSafeInteger(count) && count >= 0;

    return {
      ...category,
      sourceKey: category.key,
      status: verified ? "verified" : "unverified",
      count: verified ? count : null,
    };
  });
}

export function visibleOrganizationDeletionDependencies(categories = []) {
  return categories.filter((category) => category.status === "unverified" || category.count > 0);
}

export function normalizeTrustedOrganizationDependencies(dependencies = []) {
  const knownCategories = new Map(ORGANIZATION_DELETION_REVIEW_CATEGORIES.map((category) => [category.key, category]));

  return dependencies.map((dependency, index) => {
    const category = knownCategories.get(dependency.key);
    const count = dependency.count;
    return {
      ...(category || {}),
      key: `${dependency.key || "system_dependency"}:${dependency.table || index}`,
      sourceKey: dependency.key || "system_dependency",
      label: category?.label || dependency.label || "Unknown / legacy dependency",
      kind: dependency.classification === "historical_preserved"
        ? "history"
        : dependency.classification === "system_dependency"
          ? "unverified"
          : category?.kind || "manageable",
      destination: category?.destination || null,
      status: Number.isSafeInteger(count) && count >= 0 ? "verified" : "unverified",
      count: Number.isSafeInteger(count) && count >= 0 ? count : null,
      explanation: category?.explanation || dependency.resolution || "Trusted verification identified a blocking relationship.",
    };
  });
}

export function getOrganizationDeletionAdvisorySummary(categories = []) {
  const visible = visibleOrganizationDeletionDependencies(categories);
  const unverifiedCount = visible.filter((category) => category.status === "unverified").length;
  const recordCount = visible.reduce((sum, category) => sum + (category.count || 0), 0);

  return { visible, unverifiedCount, recordCount };
}
