import { ELECTION_EDIT_FIELDS } from "./electionEditContract.js";

const uncertainError = () => Object.assign(new Error(
  "Election creation could not be confirmed. It may already have been saved. Check the election list before starting another creation; do not resubmit this form."
), { code: "ELECTION_CREATE_UNCONFIRMED" });

// One controller per Create form. Coalesce simultaneous submissions, retain a
// confirmed ID, and refuse a second INSERT after an ambiguous network outcome.
export function createElectionSubmission(client) {
  let pending = null;
  let confirmed = null;
  let uncertain = false;
  return function submit(values, expectedOrganizationId) {
    if (confirmed) return Promise.resolve(confirmed);
    if (uncertain) return Promise.resolve({ data: null, error: uncertainError() });
    if (pending) return pending;
    pending = (async () => {
      let insertStarted = false;
      try {
        if (!values || Object.keys(values).some(key => !ELECTION_EDIT_FIELDS.includes(key)) ||
            !Number.isSafeInteger(values.academic_term_id) || values.academic_term_id <= 0 ||
            typeof values.title !== "string" || !values.title.trim()) throw new Error("Check the election title, academic term and configuration.");
        const { data: identity, error: authError } = await client.auth.getUser();
        if (authError || !identity?.user?.id) throw Object.assign(new Error("Your session has expired. Sign in again."), { status: 401 });
        const { data: actor, error: actorError } = await client.from("admin_users")
          .select("id, role, status, organization_id").eq("auth_user_id", identity.user.id).eq("status", "active").maybeSingle();
        if (actorError || !actor || actor.status !== "active" || !["electoral_board", "super_admin"].includes(actor.role)) {
          throw Object.assign(new Error("Active Electoral Board or Super Admin access is required."), { status: 403 });
        }
        const organizationId = actor.role === "electoral_board" ? actor.organization_id : values.organization_id;
        if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
            (actor.role === "electoral_board" && (Number(expectedOrganizationId) !== organizationId || values.organization_id !== organizationId))) {
          throw Object.assign(new Error("The election is outside your assigned organization. Refresh your session."), { status: 403 });
        }
        const { data: term, error: termError } = await client.from("academic_terms")
          .select("id, status").eq("id", values.academic_term_id).single();
        if (termError || !term || !["active", "draft"].includes(term.status)) throw new Error("Choose an available active or draft academic term. Closed-term history cannot be used for a new election.");
        insertStarted = true;
        const result = await client.from("elections").insert([{ ...values, organization_id: organizationId }])
          .select("id").single().retry(false);
        if (result.error) {
          if ((!result.status || result.status >= 500) && !/temporary official-production development write safeguard/.test(result.error.message || "")) {
            uncertain = true;
            return { data: null, error: uncertainError() };
          }
          return result;
        }
        if (!Number.isSafeInteger(result.data?.id) || result.data.id <= 0) {
          uncertain = true;
          return { data: null, error: uncertainError() };
        }
        confirmed = result;
        return result;
      } catch (error) {
        if (insertStarted && !/temporary official-production development write safeguard/.test(error?.message || "")) {
          uncertain = true;
          return { data: null, error: uncertainError() };
        }
        return { data: null, error };
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
