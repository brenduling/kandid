const receiptFields = [
  "id",
  "election_id",
  "position_id",
  "is_abstain",
  "ballot_id",
  "vote_hash",
  "blockchain_anchor_status",
  "hash_version",
  "blockchain_network",
  "blockchain_block_number",
  "blockchain_anchored_at",
  "blockchain_tx_id",
  "vote_timestamp",
];

export function isActiveStudentForAuthUser(profile, authId) {
  return Boolean(profile && profile.auth_user_id === authId && profile.status === "active");
}

export function isActiveAdminForAuthUser(profile, authId, requiredRole) {
  return Boolean(
    profile &&
    profile.auth_user_id === authId &&
    profile.status === "active" &&
    ["super_admin", "electoral_board"].includes(profile.role) &&
    (!requiredRole || profile.role === requiredRole),
  );
}

export function boardCanAccessOrganization(profile, organizationId) {
  return Boolean(
    profile?.role === "electoral_board" &&
    profile.organization_id != null &&
    Number(profile.organization_id) === Number(organizationId),
  );
}

export function boardCanAccessStudentMembership(profile, organizationId, studentHasMembership) {
  return profile?.role === "electoral_board" &&
    boardCanAccessOrganization(profile, organizationId) &&
    studentHasMembership === true;
}

export function projectOwnStudentReceipt(record) {
  const receipt = Object.fromEntries(receiptFields
    .filter((field) => Object.hasOwn(record || {}, field))
    .map((field) => [field, record[field]]));
  const organization = record?.elections?.organizations;
  receipt.elections = record?.elections ? {
    title: record.elections.title ?? null,
    organizations: organization ? {
      name: organization.name ?? null,
      description: organization.description ?? null,
      logo_url: organization.logo_url ?? null,
    } : null,
  } : null;
  const position = record?.positions;
  receipt.positions = position ? {
    id: position.id ?? null,
    name: position.name ?? null,
    display_order: position.display_order ?? null,
  } : null;
  return receipt;
}
