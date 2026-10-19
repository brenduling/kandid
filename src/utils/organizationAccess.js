import { supabase } from "../lib/supabaseClient";
import { clearCachedValue, getCachedValue, setCachedValue } from "./sessionCache";

export function normalizeProgram(program) {
  return String(program || "").trim().toUpperCase();
}

function uniqueById(items) {
  return Array.from(
    new Map((items || []).filter(Boolean).map((item) => [Number(item.id), item])).values(),
  );
}

function hasSupportedMembershipScope(organization) {
  return ["program", "manual", "institution"].includes(organization?.membership_scope);
}

function isMissingSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("could not find a relationship") ||
    message.includes("schema cache")
  );
}

function migrationRequiredError() {
  return new Error(
    "Apply the trusted organization program coverage migration before managing programs.",
  );
}

export function activeMembershipQuery(query) {
  return query;
}

/** Legacy structural-link reader; it is not a current-term membership contract. */
export async function selectActiveMemberships(select, filters = [], options = {}) {
  const buildBaseQuery = () => {
    let query = supabase.from("student_organizations").select(select, options);
    filters.forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    return query;
  };

  return buildBaseQuery();
}

export async function getCurrentOrganizationMemberCount(organizationId, { includeMemberIds = false, studentView = false } = {}) {
  if (studentView) {
    const id = Number(organizationId);
    if (!Number.isSafeInteger(id) || id <= 0 || includeMemberIds) return { data: null, error: new Error("Member count unavailable") };
    try {
      const { data, error } = await supabase.functions.invoke("student-profile", {
        body: { action: "organization_member_count", organization_id: id },
      });
      const result = data?.data;
      if (error || result?.organization_id !== id || !Number.isSafeInteger(result?.count) || result.count < 0 ||
        result?.academic_term?.status !== "active" || !Number.isSafeInteger(result?.academic_term?.id) || result.academic_term.id <= 0) {
        throw new Error("Member count unavailable");
      }
      return { data: result, error: null };
    } catch {
      return { data: null, error: new Error("Member count unavailable") };
    }
  }
  const { data: result, error } = await supabase.functions.invoke(
    "organization-eligibility",
    {
      body: {
        action: "current_organization_member_count",
        organization_id: organizationId,
        ...(includeMemberIds ? { include_member_ids: true } : {}),
      },
    },
  );

  if (
    error ||
    !Number.isInteger(result?.data?.count) ||
    result.data.count < 0 ||
    (includeMemberIds && (
      !Array.isArray(result?.data?.member_student_ids) ||
      result.data.member_student_ids.length !== result.data.count ||
      new Set(result.data.member_student_ids.map(Number)).size !== result.data.count
    ))
  ) {
    return { data: null, error: new Error("Member count unavailable") };
  }
  return { data: result.data, error: null };
}

export async function getCurrentOrganizationMembers(organizationId) {
  if (!organizationId) return { data: [], count: 0, academicTerm: null, error: null };
  const { data: result, error } = await supabase.functions.invoke("organization-eligibility", {
    body: { action: "current_organization_members", organization_id: Number(organizationId) },
  });
  const members = result?.data?.members;
  const rowsAreValid = Array.isArray(members) && members.every((membership) =>
    Number.isInteger(Number(membership?.student_id)) &&
    Number(membership.student_id) > 0 &&
    Number(membership.organization_id) === Number(organizationId) &&
    Number(membership.student?.id) === Number(membership.student_id) &&
    Number(membership.academic_term_id) > 0 &&
    hasSupportedMembershipScope(membership.organization) &&
    membership.membership_status === "active",
  );
  const termIsActive = result?.data?.academic_term?.status === "active" &&
    Number.isInteger(Number(result?.data?.academic_term?.id)) && Number(result.data.academic_term.id) > 0;
  if (error || !rowsAreValid || !termIsActive || !Number.isInteger(result?.data?.count) || result.data.count !== members.length) {
    return { data: null, count: null, academicTerm: null, error: new Error("Current organization roster unavailable") };
  }
  return {
    data: members,
    count: result.data.count,
    academicTerm: result.data.academic_term || null,
    organization: result.data.organization || null,
    error: null,
  };
}

export async function getCurrentMembershipsForStudents(studentIds = []) {
  const ids = [...new Set(studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return { data: [], academicTerm: null, error: null };
  const { data: result, error } = await supabase.functions.invoke("organization-eligibility", {
    body: { action: "current_memberships_for_students", student_ids: ids },
  });
  const memberships = result?.data?.memberships;
  const termIsActive = result?.data?.academic_term?.status === "active" &&
    Number.isInteger(Number(result?.data?.academic_term?.id)) && Number(result.data.academic_term.id) > 0;
  if (error || !Array.isArray(memberships) || memberships.some((membership) =>
    !ids.includes(Number(membership?.student_id)) ||
    !Number.isInteger(Number(membership?.organization_id)) ||
    Number(membership.organization_id) <= 0 ||
    Number(membership?.student?.id) !== Number(membership.student_id) ||
    !Number.isInteger(Number(membership?.academic_term_id)) ||
    Number(membership?.academic_term_id) <= 0 ||
    !hasSupportedMembershipScope(membership?.organization) ||
    membership?.membership_status !== "active"
  ) || !termIsActive) {
    return { data: null, academicTerm: null, error: new Error("Current student memberships unavailable") };
  }
  return { data: memberships, academicTerm: result.data.academic_term || null, error: null };
}

export async function selectOrganizationMembershipsForManagement(organizationId, options = {}) {
  if (!organizationId) return { data: [], error: null, count: 0 };
  const { data: roster, error } = await getCurrentOrganizationMembers(organizationId);
  if (error) return { data: [], error, count: 0 };

  const search = String(options.search || "").trim().toLowerCase();
  let rows = roster.map((membership) => ({
    student_id: membership.student_id,
    organization_id: membership.organization_id,
    role: "member",
    membership_status: "active",
    source: membership.source,
    academic_term_id: membership.academic_term_id,
    program: membership.program,
    year_level: membership.year_level,
    students: {
      ...membership.student,
      program: membership.program,
      year_level: membership.year_level,
    },
  }));
  if (search) {
    rows = rows.filter((row) => [
      row.students?.student_number,
      row.students?.first_name,
      row.students?.last_name,
      row.students?.email,
      row.program,
    ].some((value) => String(value || "").toLowerCase().includes(search)));
  }

  const sortBy = options.sortBy || "newest";
  rows.sort((left, right) => {
    const a = left.students || {};
    const b = right.students || {};
    if (sortBy === "name_desc" || sortBy === "name_asc") {
      const order = `${a.last_name || ""} ${a.first_name || ""}`.localeCompare(`${b.last_name || ""} ${b.first_name || ""}`);
      return sortBy === "name_desc" ? -order : order;
    }
    if (sortBy === "oldest" || sortBy === "newest") {
      const order = String(a.created_at || "").localeCompare(String(b.created_at || ""));
      return sortBy === "oldest" ? order : -order;
    }
    if (sortBy === "id_desc" || sortBy === "id_asc") {
      const order = String(a.student_number || "").localeCompare(String(b.student_number || ""));
      return sortBy === "id_desc" ? -order : order;
    }
    return String(a.last_name || "").localeCompare(String(b.last_name || ""));
  });

  const count = rows.length;
  if (options.pageSize) {
    const page = Math.max(1, Number(options.page) || 1);
    const start = (page - 1) * options.pageSize;
    rows = rows.slice(start, start + options.pageSize);
  }
  return { data: rows, error: null, count };
}

export async function getOrganizationProgramLinks() {
  if (getCachedValue("organization-program-schema-missing", Number.MAX_SAFE_INTEGER)) {
    return [];
  }

  const cached = getCachedValue("organization-program-links");
  if (cached) return cached;

  const { data, error } = await supabase
    .from("organization_programs")
    .select(`
      organization_id,
      program_id,
      programs (
        id,
        code,
        name
      )
    `);

  if (error) {
    if (isMissingSchemaError(error)) {
      setCachedValue("organization-program-schema-missing", true);
      return setCachedValue("organization-program-links", []);
    }

    console.warn("Organization program coverage is unavailable:", error.message);
    return setCachedValue("organization-program-links", []);
  }

  return setCachedValue("organization-program-links", data || []);
}

export async function attachProgramCoverage(organizations = []) {
  const links = await getOrganizationProgramLinks();
  const linksByOrganization = new Map();

  for (const link of links) {
    const organizationId = Number(link.organization_id);
    const current = linksByOrganization.get(organizationId) || [];
    current.push({
      program_id: link.program_id,
      programs: link.programs,
    });
    linksByOrganization.set(organizationId, current);
  }

  return (organizations || []).map((organization) => ({
    ...organization,
    organization_programs:
      linksByOrganization.get(Number(organization.id)) ||
      organization.organization_programs ||
      [],
  }));
}

export function clearOrganizationAccessCache(studentId) {
  clearCachedValue("programs");
  clearCachedValue("organization-catalog");
  clearCachedValue("organization-program-links");
  clearCachedValue("organization-program-schema-missing");
  clearCachedValue("institution-wide-organization-ids");
  if (studentId) {
    clearCachedValue(`student-structural-links:${studentId}`);
  }
}

export async function getPrograms() {
  if (getCachedValue("program-schema-missing", Number.MAX_SAFE_INTEGER)) {
    return [];
  }

  const cached = getCachedValue("programs");
  if (cached) return cached;

  const { data, error } = await supabase
    .from("programs")
    .select("id, code, name")
    .order("code", { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) {
      setCachedValue("program-schema-missing", true);
      return setCachedValue("programs", []);
    }

    console.warn("Failed to load programs:", error.message);
    return setCachedValue("programs", []);
  }

  return setCachedValue("programs", data || []);
}

export async function ensureProgram(codeOrName) {
  const code = normalizeProgram(codeOrName);
  if (!code) return { data: null, error: null };

  if (getCachedValue("program-schema-missing", Number.MAX_SAFE_INTEGER)) {
    return { data: null, error: migrationRequiredError() };
  }

  const { data, error } = await supabase.rpc(
    "kandid_ensure_program_catalog_entry",
    { p_code: code },
  );

  if (!error) {
    clearCachedValue("programs");
  } else if (isMissingSchemaError(error)) {
    setCachedValue("program-schema-missing", true);
    return { data: null, error: migrationRequiredError() };
  }

  return { data: Array.isArray(data) ? data[0] || null : data, error };
}

export async function replaceOrganizationProgramCoverage(
  organizationId,
  programIds = [],
) {
  if (!organizationId) {
    return { data: null, error: new Error("An organization is required.") };
  }

  const normalizedIds = (programIds || []).map(Number);

  const { data, error } = await supabase.rpc(
    "kandid_replace_organization_program_coverage",
    {
      p_organization_id: Number(organizationId),
      p_program_ids: normalizedIds,
    },
  );

  if (!error) clearOrganizationAccessCache();
  return { data, error };
}

export async function saveOrganizationConfiguration({
  organizationId = null,
  name,
  description = "",
  logoUrl = null,
  organizationType,
  programIds = [],
}) {
  const { data, error } = await supabase.rpc(
    "kandid_save_organization_configuration",
    {
      p_organization_id: organizationId ? Number(organizationId) : null,
      p_name: String(name || "").trim(),
      p_description: String(description || "").trim(),
      p_logo_url: logoUrl || null,
      p_organization_type: organizationType,
      p_program_ids: (programIds || []).map(Number),
    },
  );

  if (!error) clearOrganizationAccessCache();
  return { data: Array.isArray(data) ? data[0] || null : data, error };
}

export async function getOrganizationCatalog() {
  const cached = getCachedValue("organization-catalog");
  if (cached) return cached;

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, description, organization_type, membership_scope")
    .order("name", { ascending: true });

  if (error) {
    console.error("Failed to load organization catalog:", error);
    return [];
  }

  const organizations = await attachProgramCoverage(data || []);
  return setCachedValue("organization-catalog", organizations);
}

export async function getStudentDashboardMemberships(student, client = supabase) {
  if (!student?.id) throw new Error("A verified Student profile is required.");
  const { data: result, error } = await client.functions.invoke("student-profile", {
    body: { action: "organization_memberships" },
  });
  const data = result?.data;
  const termId = Number(data?.academic_term?.id);
  const rows = data?.memberships;
  const valid = !error && Number(data?.student_id) === Number(student.id) &&
    Number.isInteger(termId) && termId > 0 && data?.academic_term?.status === "active" &&
    Array.isArray(rows) && Number.isInteger(data.count) && data.count === rows.length &&
    new Set(rows.map(row => Number(row?.organization_id))).size === rows.length &&
    (data.enrollment === null ? rows.length === 0 : data.enrollment?.enrollment_status === "enrolled" && Number(data.enrollment?.academic_term_id) === termId) &&
    rows.every(row => Number.isInteger(Number(row?.organization_id)) && Number(row.organization_id) > 0 &&
      Number(row.academic_term_id) === termId && row.membership_status === "active" &&
      Number(row.organization?.id) === Number(row.organization_id) && hasSupportedMembershipScope(row.organization));
  if (!valid) {
    const failure = new Error("Your current-term organizations could not be loaded. Try again.", { cause: error });
    failure.status = error?.context?.status || error?.status;
    throw failure;
  }
  return { memberships: rows, academicTerm: data.academic_term };
}

export async function getStudentOrganizationDirectory(student) {

  const [current, organizations] = await Promise.all([
    getStudentDashboardMemberships(student),
    getOrganizationCatalog(),
  ]);
  // Authorized membership metadata comes from the trusted endpoint, so public
  // catalog visibility can never silently erase an existing membership.
  const memberOrganizations = current.memberships.map(membership => membership.organization);

  const memberIds = new Set(
    (memberOrganizations || []).map((organization) => Number(organization.id)),
  );

  const otherOrganizations = (organizations || []).filter(
    (organization) => !memberIds.has(Number(organization.id)),
  );

  return {
    memberOrganizations: memberOrganizations || [],
    otherOrganizations,
    memberIds,
    academicTerm: current.academicTerm,
  };
}

/** Structural compatibility links; not authoritative current memberships. */
export async function getStudentStructuralOrganizationLinks(studentId) {
  if (!studentId) return [];

  const cacheKey = `student-structural-links:${studentId}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  const { data, error } = await selectActiveMemberships(
    `
      organization_id,
      role,
      organizations (
        id,
        name,
        description,
        organization_type,
        logo_url
      )
    `,
    [["student_id", studentId]],
  );

  if (error) {
    console.error("Failed to load student organizations:", error);
    return [];
  }

  const organizationsWithCoverage = await attachProgramCoverage(
    (data || []).map((membership) => membership.organizations).filter(Boolean),
  );
  const coverageById = new Map(
    organizationsWithCoverage.map((organization) => [
      Number(organization.id),
      organization,
    ]),
  );

  const memberships = (data || []).map((membership) => ({
    ...membership,
    organizations:
      coverageById.get(Number(membership.organization_id)) ||
      membership.organizations,
  }));

  return setCachedValue(cacheKey, memberships);
}

export async function getStudentCurrentMemberships(student) {
  if (!student?.id) return [];

  const { data, error } = await supabase.functions.invoke("organization-eligibility", {
    body: {
      action: "student_organization_ids",
    },
  });
  const memberships = data?.data?.memberships;
  const organizationIds = data?.data?.organization_ids;
  const termIsActive = data?.data?.academic_term?.status === "active" &&
    Number.isInteger(Number(data?.data?.academic_term?.id)) && Number(data.data.academic_term.id) > 0;
  const membershipIds = Array.isArray(memberships)
    ? [...new Set(memberships.map((membership) => Number(membership?.organization_id)))]
    : [];
  if (
    error ||
    !Array.isArray(memberships) ||
    !Array.isArray(organizationIds) ||
    memberships.some((membership) =>
      !Number.isInteger(Number(membership?.organization_id)) ||
      Number(membership.organization_id) <= 0 ||
      !Number.isInteger(Number(membership?.academic_term_id)) ||
      Number(membership.academic_term_id) <= 0 ||
      membership?.membership_status !== "active" ||
      !hasSupportedMembershipScope(membership?.organization) ||
      Number(membership?.organization?.id) !== Number(membership?.organization_id)
    ) ||
    organizationIds.length !== memberships.length ||
    organizationIds.some((id) => !membershipIds.includes(Number(id))) ||
    !termIsActive
  ) {
    if (error) console.warn("Current student memberships are unavailable.");
    return [];
  }
  const currentMemberships = memberships.map((membership) => ({
    id: Number(membership.organization_id),
    organization_id: Number(membership.organization_id),
    academic_term_id: Number(membership.academic_term_id),
    membership_status: membership.membership_status || "active",
    source: membership.source || null,
    program: membership.program || null,
    year_level: membership.year_level || null,
    organizations: membership.organization || null,
  }));
  return uniqueById(currentMemberships);
}

export async function getEligibleStudentOrganizations(student) {
  if (!student?.id) return [];

  const [organizationIds, organizations] = await Promise.all([
    getStudentElectionOrganizationIds(student),
    getOrganizationCatalog(),
  ]);

  const allowedIds = new Set(
    (organizationIds || []).map((organizationId) => Number(organizationId)),
  );

  return uniqueById(
    (organizations || []).filter((organization) => allowedIds.has(Number(organization.id))),
  );
}

export async function getEligibleStudentOrganizationIds(student) {
  return getStudentElectionOrganizationIds(student);
}

export async function getStudentElectionOrganizationIds(student, client = supabase) {
  // Reuse the installed, JWT-scoped current-term contract. A failed request is
  // not evidence that the student has no memberships.
  const { memberships } = await getStudentDashboardMemberships(student, client);
  return [...new Set(memberships.map((membership) => Number(membership.organization_id)).filter(Boolean))];
}

export async function fetchEligibleStudentsForOrganization(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase.functions.invoke("organization-eligibility", {
    body: {
      action: "eligible_students_for_organization",
      organization_id: Number(organizationId),
    },
  });

  if (error) {
    throw error;
  }

  const students = data?.data?.students;
  if (!Array.isArray(students)) {
    throw new Error("Eligible student response was invalid.");
  }

  return uniqueById(students);
}
