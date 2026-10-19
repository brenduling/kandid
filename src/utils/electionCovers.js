export const ELECTION_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const ELECTION_COVER_TYPES = Object.freeze({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
});
export const ELECTION_COVER_PATH = /^[1-9][0-9]*\/(?:drafts|elections\/[1-9][0-9]*)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;
const validId = (id) => Number.isInteger(id) && id > 0 && id <= 2147483647;

export async function validateElectionCover(file) {
  if (!(file instanceof Blob) || !Object.hasOwn(ELECTION_COVER_TYPES, file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
  }
  if (!file.size || file.size > ELECTION_COVER_MAX_BYTES) throw new Error("Cover images must be between 1 byte and 5 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = {
    "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/png": [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b),
    "image/webp": ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP",
    "image/gif": ["GIF87a", "GIF89a"].includes(ascii(0, 6)),
  };
  if (!valid[file.type]) throw new Error("The selected file does not match its image format. Choose another image.");
}

export function electionCoverError(error) {
  if (/bucket.*not found|bucket.*does not exist/i.test(error?.message || "")) return "Election cover Storage is not activated yet. The reviewed bucket repair needs production approval.";
  if (Number(error?.statusCode || error?.status) === 403 || /row.level security|permission denied/i.test(error?.message || "")) return "Cover upload is not permitted for this account or election. Refresh your session and check your organization access.";
  return error?.message || "The cover could not be uploaded. Your existing cover has not changed.";
}

// Immutable uploads: replacing a cover uploads a fresh object and changes only
// the unsaved form URL. Never overwrite/delete an existing or shared object.
export async function uploadElectionCover(client, file, { organizationId, electionId = null }) {
  await validateElectionCover(file);
  organizationId = Number(organizationId);
  if (!validId(organizationId) || (electionId !== null && !validId(Number(electionId)))) throw new Error("Choose an authorized organization and election before uploading a cover.");
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity?.user?.id) throw new Error("Your session has expired. Sign in again.");
  const { data: actor, error: actorError } = await client.from("admin_users")
    .select("role, status, organization_id").eq("auth_user_id", identity.user.id).eq("status", "active").maybeSingle();
  if (actorError || !actor || actor.status !== "active" || !["electoral_board", "super_admin"].includes(actor.role) ||
      (actor.role === "electoral_board" && actor.organization_id !== organizationId)) throw new Error("An active administrator in this organization is required to upload a cover.");
  if (electionId !== null) {
    const { data: election, error } = await client.from("elections").select("id, organization_id, removed_at")
      .eq("id", Number(electionId)).eq("organization_id", organizationId).single();
    if (error || !election || election.organization_id !== organizationId || election.removed_at !== null) throw new Error("This election is unavailable in your authorized organization.");
  }
  const path = `${organizationId}/${electionId === null ? "drafts" : `elections/${Number(electionId)}`}/${globalThis.crypto.randomUUID()}.${ELECTION_COVER_TYPES[file.type]}`;
  const storage = client.storage.from("election-covers");
  const { error } = await storage.upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) throw new Error(electionCoverError(error));
  const { data } = storage.getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Upload finished but its cover URL could not be confirmed. Keep the existing cover and retry.");
  return data.publicUrl;
}
