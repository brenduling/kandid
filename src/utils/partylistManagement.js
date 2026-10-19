const contentFields = ["name", "description", "logo_url"];
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const failure = (message, code = "PARTYLIST_VALIDATION") => Object.assign(new Error(message), { code });

export function isValidPartylistContent(row) {
  return Boolean(row && typeof row === "object" && !Array.isArray(row) &&
    Object.keys(row).length === contentFields.length &&
    Object.keys(row).every((key) => contentFields.includes(key)) &&
    typeof row.name === "string" && row.name === row.name.trim() &&
    row.name.length > 0 && row.name.length <= 100 &&
    [...row.name].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127) &&
    typeof row.description === "string" && (row.logo_url === null || typeof row.logo_url === "string"));
}

export function validatePartylistValues(values) {
  if (!values || Object.keys(values).some((key) => !contentFields.includes(key))) {
    throw failure("Only the partylist name, description and logo can be changed.");
  }
  const row = {
    name: typeof values.name === "string" ? values.name.trim() : "",
    description: typeof values.description === "string" ? values.description.trim() : "",
    logo_url: typeof values.logo_url === "string" ? values.logo_url.trim() || null : null,
  };
  if (!isValidPartylistContent(row)) throw failure("Enter a partylist name of 1–100 characters.");
  return row;
}

// Resolve scope from the verified Auth identity and its database profile, never
// from editable form fields or the browser's stored display profile. RLS remains
// the authority for every write if assignment/status changes after this read.
export async function loadPartylistBoardContext(client, expectedOrganizationId) {
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity?.user?.id) throw failure("Sign in again to manage partylists.", "PARTYLIST_AUTH");
  const { data: profile, error } = await client.from("admin_users")
    .select("auth_user_id, role, status, organization_id, organizations(name)")
    .eq("auth_user_id", identity.user.id).maybeSingle();
  if (error) throw failure("Your Electoral Board assignment could not be verified. Refresh and try again.", "PARTYLIST_AUTH");
  const organizationId = Number(profile?.organization_id);
  if (!profile || profile.auth_user_id !== identity.user.id || profile.role !== "electoral_board" ||
      profile.status !== "active" || !positiveId(organizationId)) {
    throw failure("An active Electoral Board account with an assigned organization is required.", "PARTYLIST_AUTH");
  }
  if (expectedOrganizationId !== undefined && organizationId !== Number(expectedOrganizationId)) {
    throw failure("Your organization assignment changed. Refresh before managing partylists.", "PARTYLIST_SCOPE");
  }
  return { ...profile, organization_id: organizationId };
}

async function checkDuplicate(client, organizationId, name, excludedId) {
  const normalized = name.toLocaleLowerCase();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("partylists").select("id, name")
      .eq("organization_id", organizationId).order("id").range(offset, offset + 999);
    if (error || !Array.isArray(data)) throw failure("Existing partylist names could not be checked. Refresh and try again.");
    if (data.some((row) => Number(row.id) !== excludedId && String(row.name || "").trim().toLocaleLowerCase() === normalized)) {
      throw failure("A partylist with this name already exists in your organization.", "PARTYLIST_DUPLICATE");
    }
    if (data.length < 1000) return;
  }
}

async function verifyExisting(client, original, organizationId) {
  if (!positiveId(original?.id) || Number(original.organization_id) !== organizationId) {
    throw failure("This partylist is outside your assigned organization.", "PARTYLIST_SCOPE");
  }
  const { data, error } = await client.from("partylists").select("id")
    .eq("id", original.id).eq("organization_id", organizationId).maybeSingle();
  if (error || data?.id !== original.id) throw failure("This partylist is no longer available. Refresh the register.");
}

const unconfirmed = () => failure(
  "The partylist change could not be confirmed. Refresh the register before trying again.",
  "PARTYLIST_UNCONFIRMED",
);

async function confirmMutation(query, expectedId) {
  try {
    const result = await query.select("id").single().retry(false);
    if (result.error) {
      if (!result.status || result.status >= 500) throw unconfirmed();
      throw result.error;
    }
    if (!positiveId(result.data?.id) || expectedId !== undefined && result.data.id !== expectedId) throw unconfirmed();
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw unconfirmed();
  }
}

// A wizard submission sends at most one INSERT, including double clicks and an
// uncertain network response. A new wizard may retry only after a fresh check.
export function createPartylistSubmission(client) {
  let pending, confirmed, uncertain = false;
  return function submit(values, organizationId) {
    if (confirmed) return Promise.resolve(confirmed);
    if (uncertain) return Promise.resolve({ data: null, error: unconfirmed() });
    if (pending) return pending;
    pending = (async () => {
      try {
        const row = validatePartylistValues(values);
        const board = await loadPartylistBoardContext(client, organizationId);
        await checkDuplicate(client, board.organization_id, row.name);
        confirmed = await confirmMutation(client.from("partylists").insert([{ ...row, organization_id: board.organization_id }]));
        return confirmed;
      } catch (error) {
        uncertain = error?.code === "PARTYLIST_UNCONFIRMED";
        return { data: null, error };
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}

export async function savePartylistEdit(client, original, values, organizationId) {
  try {
    const row = validatePartylistValues(values);
    const board = await loadPartylistBoardContext(client, organizationId);
    await verifyExisting(client, original, board.organization_id);
    await checkDuplicate(client, board.organization_id, row.name, original.id);
    return await confirmMutation(client.from("partylists").update(row)
      .eq("id", original.id).eq("organization_id", board.organization_id), original.id);
  } catch (error) { return { data: null, error }; }
}

export async function deletePartylist(client, original, organizationId) {
  try {
    const board = await loadPartylistBoardContext(client, organizationId);
    await verifyExisting(client, original, board.organization_id);
    // Fail closed even if the legacy dependency preview cannot read candidates.
    // The existing FK also rejects a candidate linked concurrently with DELETE.
    const { count, error } = await client.from("candidates").select("id", { head: true, count: "exact" })
      .eq("partylist_id", original.id);
    if (error || !Number.isSafeInteger(count) || count < 0) throw failure("Candidate links could not be verified. This partylist was not deleted.");
    if (count > 0) throw failure("Reassign or remove linked candidates before deleting this partylist.", "PARTYLIST_REFERENCED");
    return await confirmMutation(client.from("partylists").delete()
      .eq("id", original.id).eq("organization_id", board.organization_id), original.id);
  } catch (error) { return { data: null, error }; }
}

export function partylistErrorMessage(error) {
  if (error?.code === "23505" || error?.code === "PARTYLIST_DUPLICATE") return "A partylist with this name already exists in your organization.";
  if (error?.code === "42501" || error?.status === 403) return "You do not have permission to change this partylist. Refresh your Board session and try again.";
  if (error?.code === "PGRST116") return "The partylist changed or your access was revoked. Refresh the register before trying again.";
  if (error?.code === "23503") return "This partylist is linked to other records and cannot be deleted. Reassign its candidates first.";
  if (error?.code?.startsWith("PARTYLIST_")) return error.message;
  if (/temporary official-production development write safeguard/.test(error?.message || "")) return "This partylist request was blocked by the local development safeguard. Refresh the app before retrying.";
  return "The partylist change could not be confirmed. Refresh the register before trying again.";
}
