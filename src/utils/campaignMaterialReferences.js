const STORAGE_REFERENCE = /^storage:\/\/campaign-materials\/([1-9][0-9]*)\/([1-9][0-9]*)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp|mp4|webm|pdf)$/i;

export function parseCampaignMaterialReference(value) {
  if (typeof value !== "string") return null;
  const match = value.match(STORAGE_REFERENCE);
  if (!match) return null;
  return {
    organizationId: Number(match[1]),
    electionId: Number(match[2]),
    path: `${match[1]}/${match[2]}/${match[3]}.${match[4].toLowerCase()}`,
    extension: match[4].toLowerCase(),
  };
}
