export function adaptOfficerDirectoryRows(rows = []) {
  return rows.map((officer) => ({
    ...officer,
    organizations: { name: officer.organization_name },
    students: officer.first_name || officer.last_name
      ? {
          first_name: officer.first_name || "",
          last_name: officer.last_name || "",
          photo_url: officer.photo_url || null,
        }
      : null,
  }));
}
