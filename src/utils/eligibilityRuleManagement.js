const fields = ["program", "min_year_level", "max_year_level", "allow_shs"];
const positiveId = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const failure = (message, code = "RULE_VALIDATION") => Object.assign(new Error(message), { code });
const programCode = (value) => String(value || "").trim().toUpperCase();
const validYear = (value) => value === null || Number.isInteger(value) && value >= 1 && value <= 6;

// Presentation follows the election policy metadata. The database remains the
// authority for whether an installed policy enforces the saved declarations.
export const enforcesElectionEligibilityRules = (election) =>
  Number(typeof election === "object" ? election?.electorate_policy_version : NaN) === 1;

export function isValidEligibilityRuleContent(row) {
  return Boolean(row && typeof row === "object" && !Array.isArray(row) &&
    Object.keys(row).length === fields.length && Object.keys(row).every((key) => fields.includes(key)) &&
    (row.program === null || typeof row.program === "string" && row.program.length > 0 && row.program.length <= 100 &&
      row.program === programCode(row.program) && [...row.program].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)) &&
    validYear(row.min_year_level) && validYear(row.max_year_level) &&
    (row.min_year_level === null || row.max_year_level === null || row.min_year_level <= row.max_year_level) &&
    typeof row.allow_shs === "boolean");
}

export function validateEligibilityRuleValues(values) {
  if (!values || Object.keys(values).some((key) => ![...fields, "election_id"].includes(key))) throw failure("The rule contains unsupported fields.");
  if (values.program != null && typeof values.program !== "string" || typeof values.election_id === "boolean") throw failure("Choose a valid election and program code.");
  const year = (value) => value === "" || value === null || value === undefined ? null : typeof value === "boolean" ? NaN : Number(value);
  const row = {
    program: programCode(values.program) || null,
    min_year_level: year(values.min_year_level), max_year_level: year(values.max_year_level), allow_shs: values.allow_shs,
  };
  if (!isValidEligibilityRuleContent(row)) throw failure("Use college year levels 1–6, keep From no greater than To, and select whether Senior High School is included.");
  const electionId = Number(values.election_id);
  if (!positiveId(electionId)) throw failure("Choose a valid election.");
  return { ...row, election_id: electionId };
}

// This detects contradictory/redundant declarations, not voting authorization.
// Blank programs/bounds mean unrestricted declared coverage in that dimension;
// SHS coverage is independent of the college-year interval.
export function eligibilityRuleConflict(row, existing = [], excludedId) {
  for (const other of existing) {
    if (Number(other.id) === excludedId) continue;
    const sameProgram = programCode(row.program) === programCode(other.program);
    const sameRange = ["min_year_level", "max_year_level"].every((key) => (row[key] ?? null) === (other[key] ?? null));
    if (sameProgram && sameRange && row.allow_shs === (other.allow_shs === true)) return "duplicate";
    const programsOverlap = !programCode(row.program) || !programCode(other.program) || sameProgram;
    const yearsOverlap = Math.max(row.min_year_level ?? 1, other.min_year_level ?? 1) <=
      Math.min(row.max_year_level ?? 6, other.max_year_level ?? 6);
    if (programsOverlap && (yearsOverlap || row.allow_shs && other.allow_shs === true)) return "overlap";
  }
  return null;
}

export async function loadEligibilityBoardContext(client, expectedOrganizationId) {
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity?.user?.id) throw failure("Sign in again to manage declared eligibility rules.", "RULE_AUTH");
  const { data, error } = await client.from("admin_users")
    .select("auth_user_id, role, status, organization_id, organizations(name, membership_scope)")
    .eq("auth_user_id", identity.user.id).maybeSingle();
  if (error || !data || data.auth_user_id !== identity.user.id || data.role !== "electoral_board" ||
      data.status !== "active" || !Number.isSafeInteger(Number(data.organization_id)) || Number(data.organization_id) <= 0) {
    throw failure("Your active Electoral Board organization assignment could not be verified. Refresh and try again.", "RULE_AUTH");
  }
  if (expectedOrganizationId !== undefined && Number(data.organization_id) !== Number(expectedOrganizationId)) {
    throw failure("Your organization assignment changed. Refresh the rule register before saving.", "RULE_SCOPE");
  }
  return { ...data, organization_id: Number(data.organization_id) };
}

export async function loadEligibilityPrograms(client) {
  const { data, error } = await client.from("programs").select("code, name").order("code");
  if (error || !Array.isArray(data)) throw failure("The program catalog could not be verified. Refresh before saving a rule.");
  return data;
}

async function loadElection(client, electionId, board) {
  if (!positiveId(electionId)) throw failure("Choose a valid election.");
  const { data, error } = await client.from("elections")
    .select("id, organization_id, academic_term_id, removed_at")
    .eq("id", electionId).eq("organization_id", board.organization_id).maybeSingle();
  if (error || !data || data.id !== electionId || Number(data.organization_id) !== board.organization_id || !Object.hasOwn(data, "removed_at")) {
    throw failure("This election is unavailable in your assigned organization.", "RULE_SCOPE");
  }
  if (data.removed_at !== null) throw failure("This election has been removed. Its rules are read-only.", "RULE_REMOVED");
  // Metadata may describe historical terms. Never substitute the current term.
  // Trusted database operations enforce the scoped rule and freeze contract;
  // the browser must not reconstruct student authorization from this record.
  if (data.academic_term_id !== null) {
    const term = await client.from("academic_terms").select("id").eq("id", data.academic_term_id).maybeSingle();
    if (term.error || term.data?.id !== data.academic_term_id) throw failure("The election academic term could not be verified. No rule change was submitted.");
  }
  return data;
}

async function checkRule(client, row, excludedId) {
  const programs = await loadEligibilityPrograms(client);
  if (row.program !== null && !programs.some((program) => programCode(program.code) === row.program)) {
    throw failure("Choose a program code from the existing catalog, or leave Program unset for all programs.");
  }
  const existing = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("eligibility_rules").select("id, program, min_year_level, max_year_level, allow_shs")
      .eq("election_id", row.election_id).order("id").range(offset, offset + 999);
    if (result.error || !Array.isArray(result.data)) throw failure("Existing rules could not be checked. Refresh before saving.");
    existing.push(...result.data);
    if (result.data.length < 1000) break;
  }
  const conflict = eligibilityRuleConflict(row, existing, excludedId);
  if (conflict === "duplicate") throw failure("This declared eligibility rule already exists for the election.", "RULE_DUPLICATE");
  if (conflict) throw failure("This declaration overlaps another rule for the election. Combine the overlapping audiences or adjust the range.", "RULE_OVERLAP");
}

async function verifyOriginal(client, original, electionId) {
  if (!positiveId(original?.id) || original.election_id !== electionId) throw failure("A rule cannot be moved to another election. Refresh before editing.", "RULE_SCOPE");
  const result = await client.from("eligibility_rules").select("id").eq("id", original.id).eq("election_id", electionId).maybeSingle();
  if (result.error || result.data?.id !== original.id) throw failure("This rule is no longer available. Refresh the register.");
}

const unconfirmed = () => failure("The rule change could not be confirmed. Refresh the register before trying again.", "RULE_UNCONFIRMED");
async function confirm(query, expectedId) {
  try {
    const result = await query.select("id").single().retry(false);
    if (result.error) {
      if (!result.status || result.status >= 500) throw unconfirmed();
      throw result.error;
    }
    if (!positiveId(result.data?.id) || expectedId !== undefined && result.data.id !== expectedId) throw unconfirmed();
    return result;
  } catch (error) { throw error?.code ? error : unconfirmed(); }
}

export function createEligibilityRuleSubmission(client) {
  let pending, confirmed, uncertain = false;
  return function submit(values, organizationId) {
    if (confirmed) return Promise.resolve(confirmed);
    if (uncertain) return Promise.resolve({ error: unconfirmed() });
    if (pending) return pending;
    pending = (async () => {
      try {
        const row = validateEligibilityRuleValues(values);
        const board = await loadEligibilityBoardContext(client, organizationId);
        await loadElection(client, row.election_id, board);
        await checkRule(client, row);
        confirmed = await confirm(client.from("eligibility_rules").insert([row]));
        return confirmed;
      } catch (error) { uncertain = error?.code === "RULE_UNCONFIRMED"; return { data: null, error }; }
    })().finally(() => { pending = null; });
    return pending;
  };
}

export async function saveEligibilityRuleEdit(client, original, values, organizationId) {
  try {
    const row = validateEligibilityRuleValues(values);
    const board = await loadEligibilityBoardContext(client, organizationId);
    await loadElection(client, row.election_id, board);
    await verifyOriginal(client, original, row.election_id);
    await checkRule(client, row, original.id);
    const { election_id: electionId, ...content } = row;
    return await confirm(client.from("eligibility_rules").update(content).eq("id", original.id).eq("election_id", electionId), original.id);
  } catch (error) { return { data: null, error }; }
}

export async function deleteEligibilityRule(client, original, organizationId) {
  try {
    const board = await loadEligibilityBoardContext(client, organizationId);
    await loadElection(client, original?.election_id, board);
    await verifyOriginal(client, original, original.election_id);
    // Preserve the existing historical-delete policy using the authorized
    // dependency reader, rather than adding direct browser access to votes.
    const result = await client.functions.invoke("vote-access", { body: { action: "vote_dependency_count", entity_type: "eligibility_rule", entity_id: original.id } });
    const count = result.data?.data?.count;
    if (result.error || !Number.isSafeInteger(count) || count < 0) throw failure("Voting history could not be verified. The rule was not deleted.");
    if (count > 0) throw failure("This election has voting history. Keep its declared eligibility rules.", "RULE_HISTORY");
    return await confirm(client.from("eligibility_rules").delete().eq("id", original.id).eq("election_id", original.election_id), original.id);
  } catch (error) { return { data: null, error }; }
}

export function eligibilityRuleErrorMessage(error) {
  if (error?.code === "42501" && /eligibility rules are locked/i.test(error.message || "")) return "This election's electorate or voting history is locked. Its eligibility rules cannot be changed.";
  if (error?.code === "42501") return /removed/i.test(error.message || "") ? "This election has been removed. Its rules are read-only." : "You do not have permission to change this election's rules. Refresh your Board session.";
  if (error?.code === "PGRST116") return "The rule changed or access was revoked. Refresh before trying again.";
  if (error?.code === "23503") return "The related election is no longer available. Refresh the register.";
  if (error?.code === "23505") return "This declared eligibility rule already exists for the election.";
  if (error?.code?.startsWith("RULE_")) return error.message;
  return "The rule change could not be confirmed. Refresh the register before trying again.";
}
