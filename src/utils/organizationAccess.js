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
    "Apply the organization program sync migration before saving program coverage.",
  );
}

function membershipLifecycleRequiredError() {
  return new Error(
    "Apply the student membership lifecycle migration before deactivating or reactivating organization access.",
  );
}

async function runActiveMembershipQuery(buildQuery, fallbackQuery) {
  const { data, error, count } = await buildQuery((query) =>
    query.eq("membership_status", "active"),
  );

  if (!error) return { data, error, count };

  const message = String(error.message || "").toLowerCase();
  const missingMembershipStatus =
    error.code === "42703" ||
    message.includes("membership_status") ||
    isMissingSchemaError(error);

  if (!missingMembershipStatus || !fallbackQuery) {
    return { data, error, count };
  }

  return fallbackQuery();
}

export function activeMembershipQuery(query) {
  return query.eq("membership_status", "active");
}

export async function selectActiveMemberships(select, filters = [], options = {}) {
  const buildBaseQuery = () => {
    let query = supabase.from("student_organizations").select(select, options);
    filters.forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    return query;
  };

  return runActiveMembershipQuery(
    (applyActiveFilter) => applyActiveFilter(buildBaseQuery()),
    () => buildBaseQuery(),
  );
}

export async function selectOrganizationMembershipsForManagement(organizationId) {
  if (!organizationId) return { data: [], error: null };

  const baseStudentSelect = `
    student_id,
    organization_id,
    role,
    students (
      id,
      student_number,
      first_name,
      last_name,
      email,
      photo_url,
      program,
      year_level,
      is_shs,
      status,
      created_at
    )
  `;

  const fullSelect = `
    ${baseStudentSelect},
    membership_status,
    deactivated_at,
    deactivation_reason,
    reactivated_at
  `;

  const query = (selectText) =>
    supabase
      .from("student_organizations")
      .select(selectText)
      .eq("organization_id", organizationId);

  const { data, error } = await query(fullSelect);

  if (!error) return { data: data || [], error: null };

  const message = String(error.message || "").toLowerCase();
  const missingMembershipStatus =
    error.code === "42703" ||
    message.includes("membership_status") ||
    isMissingSchemaError(error);

  if (!missingMembershipStatus) return { data: [], error };

  const fallback = await query(baseStudentSelect);
  return {
    data: (fallback.data || []).map((membership) => ({
      ...membership,
      membership_status: "active",
    })),
    error: fallback.error,
  };
}

function getCoveredPrograms(organization) {
  return (organization?.organization_programs || [])
    .map((link) => link.programs)
    .filter(Boolean);
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
  if (studentId) {
    clearCachedValue(`student-memberships:${studentId}`);
  }
}

export function organizationCoversStudentProgram(organization, studentProgram) {
  const program = normalizeProgram(studentProgram);
  if (!program) return false;

  return getCoveredPrograms(organization).some(
    (coveredProgram) =>
      normalizeProgram(coveredProgram.code) === program ||
      normalizeProgram(coveredProgram.name) === program,
  );
}

export function isOrganizationEligibleForStudent(organization, student) {
  if (!organization || !student) return false;
  if (organization.organization_type === "non_departmental") return false;
  return organizationCoversStudentProgram(organization, student.program);
}

export async function findStudentByNumber(studentNumber) {
  const cleanedStudentNumber = String(studentNumber || "").trim();
  if (!cleanedStudentNumber) {
    return { data: null, error: new Error("Student ID is required.") };
  }

  const { data, error } = await supabase
    .from("students")
    .select(
      "id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at",
    )
    .eq("student_number", cleanedStudentNumber)
    .limit(2);

  if (error) return { data: null, error };

  if ((data || []).length > 1) {
    return {
      data: null,
      error: new Error(
        `Multiple central student records use Student ID ${cleanedStudentNumber}. Resolve duplicates before linking memberships.`,
      ),
    };
  }

  return { data: data?.[0] || null, error: null };
}

export async function findOrCreateStudentByNumber(payload) {
  const cleanedStudentNumber = String(payload?.student_number || "").trim();
  const lookup = await findStudentByNumber(cleanedStudentNumber);

  if (lookup.error) return { data: null, created: false, error: lookup.error };

  if (lookup.data) {
    return { data: lookup.data, created: false, error: null };
  }

  const insertPayload = {
    ...payload,
    student_number: cleanedStudentNumber,
  };

  const { data, error } = await supabase
    .from("students")
    .insert([insertPayload])
    .select(
      "id, student_number, first_name, last_name, email, photo_url, program, year_level, is_shs, status, created_at",
    )
    .single();

  if (!error) {
    return { data, created: true, error: null };
  }

  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  const duplicateStudentNumber =
    code === "23505" ||
    (message.includes("duplicate") && message.includes("student_number"));

  if (!duplicateStudentNumber) {
    return { data: null, created: false, error };
  }

  const retryLookup = await findStudentByNumber(cleanedStudentNumber);
  return {
    data: retryLookup.data,
    created: false,
    error: retryLookup.error,
  };
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

  const { data, error } = await supabase
    .from("programs")
    .upsert(
      {
        code,
        name: code,
      },
      {
        onConflict: "code",
      },
    )
    .select("id, code, name")
    .single();

  if (!error) {
    clearCachedValue("programs");
  } else if (isMissingSchemaError(error)) {
    setCachedValue("program-schema-missing", true);
    return { data: null, error: migrationRequiredError() };
  }

  return { data, error };
}

export async function getOrganizationCatalog() {
  const cached = getCachedValue("organization-catalog");
  if (cached) return cached;

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, description, organization_type")
    .order("name", { ascending: true });

  if (error) {
    console.error("Failed to load organization catalog:", error);
    return [];
  }

  const organizations = await attachProgramCoverage(data || []);
  return setCachedValue("organization-catalog", organizations);
}

export async function getStudentOrganizationDirectory(student) {
  if (!student?.id) {
    return {
      memberOrganizations: [],
      otherOrganizations: [],
      memberIds: new Set(),
    };
  }

  const [memberOrganizations, organizations] = await Promise.all([
    getEligibleStudentOrganizations(student),
    getOrganizationCatalog(),
  ]);

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
  };
}

export async function getStudentExplicitOrganizations(studentId) {
  if (!studentId) return [];

  const cacheKey = `student-memberships:${studentId}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  const { data, error } = await selectActiveMemberships(
    `
      organization_id,
      role,
      organizations (
        id,
        name,
        organization_type
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

export async function getEligibleStudentOrganizations(student) {
  if (!student?.id) return [];

  let studentProfile = student;

  if (!studentProfile.program) {
    const { data, error } = await supabase
      .from("students")
      .select("id, program")
      .eq("id", student.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to load student program:", error);
    } else if (data) {
      studentProfile = { ...studentProfile, ...data };
    }
  }

  const [memberships, organizations] = await Promise.all([
    getStudentExplicitOrganizations(studentProfile.id),
    getOrganizationCatalog(),
  ]);

  const explicitOrganizations = (memberships || [])
    .map((membership) => membership.organizations)
    .filter(Boolean);

  const derivedOrganizations = (organizations || []).filter((organization) =>
    isOrganizationEligibleForStudent(organization, studentProfile),
  );

  return uniqueById([...explicitOrganizations, ...derivedOrganizations]);
}

export async function getEligibleStudentOrganizationIds(student) {
  const organizations = await getEligibleStudentOrganizations(student);
  return organizations.map((organization) => organization.id);
}

export async function getStudentElectionOrganizationIds(student) {
  if (!student?.id) return [];

  let studentProfile = student;

  if (!studentProfile.program) {
    const { data, error } = await supabase
      .from("students")
      .select("id, program")
      .eq("id", student.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to load student program:", error);
    } else if (data) {
      studentProfile = { ...studentProfile, ...data };
    }
  }

  const [
    eligibleOrganizationIds,
    { data: directMemberships, error: membershipError },
    organizations,
  ] = await Promise.all([
    getEligibleStudentOrganizationIds(studentProfile),
    selectActiveMemberships("organization_id", [["student_id", studentProfile.id]]),
    getOrganizationCatalog(),
  ]);

  if (membershipError) {
    console.error("Failed to load direct student organization memberships:", membershipError);
  }

  const directOrganizationIds = (directMemberships || [])
    .map((membership) => membership.organization_id)
    .filter(Boolean);

  const programCoveredOrganizationIds = (organizations || [])
    .filter((organization) =>
      isOrganizationEligibleForStudent(organization, studentProfile),
    )
    .map((organization) => organization.id);

  return [
    ...new Set(
      [
        ...eligibleOrganizationIds,
        ...directOrganizationIds,
        ...programCoveredOrganizationIds,
      ]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];
}

export async function syncStudentOrganizationMemberships({
  studentId,
  program,
  explicitOrganizationIds = [],
}) {
  if (!studentId) {
    return {
      error: null,
      organizationIds: [],
      createdOrganizationIds: [],
      existingOrganizationIds: [],
    };
  }

  const organizations = await getOrganizationCatalog();
  const derivedIds = organizations
    .filter((organization) =>
      isOrganizationEligibleForStudent(organization, { id: studentId, program }),
    )
    .map((organization) => organization.id);

  const organizationIds = [
    ...new Set(
      [...derivedIds, ...explicitOrganizationIds]
        .map((id) => Number(id))
        .filter(Boolean),
    ),
  ];

  if (organizationIds.length === 0) {
    return {
      error: null,
      organizationIds: [],
      createdOrganizationIds: [],
      existingOrganizationIds: [],
    };
  }

  const { data: existingMemberships, error: existingError } = await supabase
    .from("student_organizations")
    .select("organization_id")
    .eq("student_id", studentId)
    .in("organization_id", organizationIds);

  if (existingError) {
    return {
      error: existingError,
      organizationIds,
      createdOrganizationIds: [],
      existingOrganizationIds: [],
    };
  }

  const existingOrganizationIds = [
    ...new Set(
      (existingMemberships || [])
        .map((membership) => Number(membership.organization_id))
        .filter(Boolean),
    ),
  ];

  const rows = organizationIds.map((organizationId) => ({
    student_id: studentId,
    organization_id: organizationId,
    role: "member",
  }));

  const { error } = await supabase
    .from("student_organizations")
    .upsert(rows, {
      onConflict: "student_id,organization_id",
      ignoreDuplicates: true,
    });

  if (!error) {
    clearCachedValue(`student-memberships:${studentId}`);
  }

  const createdOrganizationIds = organizationIds.filter(
    (organizationId) => !existingOrganizationIds.includes(Number(organizationId)),
  );

  return {
    error,
    organizationIds,
    createdOrganizationIds: error ? [] : createdOrganizationIds,
    existingOrganizationIds,
  };
}

export async function syncStudentsForOrganizationCoverage(organizationId) {
  if (!organizationId) return { error: null, syncedCount: 0 };

  clearOrganizationAccessCache();

  const [
    organizations,
    { data: students, error: studentsError },
  ] = await Promise.all([
    getOrganizationCatalog(),
    supabase
      .from("students")
      .select("id, program")
      .order("id", { ascending: true }),
  ]);

  if (studentsError) {
    return { error: studentsError, syncedCount: 0 };
  }

  const organization = organizations.find(
    (item) => String(item.id) === String(organizationId),
  );

  if (!organization) {
    return { error: null, syncedCount: 0 };
  }

  const memberships = (students || [])
    .filter((student) => isOrganizationEligibleForStudent(organization, student))
    .map((student) => ({
      student_id: student.id,
      organization_id: Number(organizationId),
      role: "member",
    }));

  if (memberships.length === 0) {
    return { error: null, syncedCount: 0 };
  }

  const { error } = await supabase
    .from("student_organizations")
    .upsert(memberships, {
      onConflict: "student_id,organization_id",
      ignoreDuplicates: true,
    });

  if (!error) {
    clearOrganizationAccessCache();
  }

  return {
    error,
    syncedCount: error ? 0 : memberships.length,
  };
}

export async function deactivateStudentOrganizationMembership({
  studentId,
  organizationId,
  reason = "",
}) {
  if (!studentId || !organizationId) {
    return { error: new Error("Student and organization are required.") };
  }

  const { error } = await supabase
    .from("student_organizations")
    .update({
      membership_status: "inactive",
      deactivated_at: new Date().toISOString(),
      deactivation_reason: reason || null,
      reactivated_at: null,
    })
    .eq("student_id", studentId)
    .eq("organization_id", organizationId);

  if (error && isMissingSchemaError(error)) {
    return { error: membershipLifecycleRequiredError() };
  }

  if (!error) {
    clearCachedValue(`student-memberships:${studentId}`);
  }

  return { error };
}

export async function reactivateStudentOrganizationMembership({
  studentId,
  organizationId,
}) {
  if (!studentId || !organizationId) {
    return { error: new Error("Student and organization are required.") };
  }

  const { error } = await supabase
    .from("student_organizations")
    .update({
      membership_status: "active",
      deactivated_at: null,
      deactivation_reason: null,
      reactivated_at: new Date().toISOString(),
    })
    .eq("student_id", studentId)
    .eq("organization_id", organizationId);

  if (error && isMissingSchemaError(error)) {
    return { error: membershipLifecycleRequiredError() };
  }

  if (!error) {
    clearCachedValue(`student-memberships:${studentId}`);
  }

  return { error };
}

export async function removeStudentOrganizationMembership({
  studentId,
  organizationId,
}) {
  if (!studentId || !organizationId) {
    return { error: new Error("Student and organization are required.") };
  }

  const { error } = await supabase
    .from("student_organizations")
    .delete()
    .eq("student_id", studentId)
    .eq("organization_id", organizationId);

  if (!error) {
    clearCachedValue(`student-memberships:${studentId}`);
  }

  return { error };
}

export async function fetchEligibleStudentsForOrganization(organizationId) {
  if (!organizationId) return [];

  const [
    organizations,
    { data: students, error: studentsError },
    { data: memberships, error: membershipError },
  ] = await Promise.all([
    getOrganizationCatalog(),
    supabase
      .from("students")
      .select("id, student_number, first_name, last_name, photo_url, program, year_level, status")
      .order("last_name", { ascending: true }),
    selectActiveMemberships(
      `
        student_id,
        students (
          id,
          student_number,
          first_name,
          last_name,
          photo_url,
          program,
          year_level,
          status
        )
      `,
      [["organization_id", organizationId]],
    ),
  ]);

  if (studentsError) {
    throw studentsError;
  }

  if (membershipError) {
    throw membershipError;
  }

  const organization = organizations.find(
    (item) => String(item.id) === String(organizationId),
  );

  if (!organization) return [];

  const derivedStudents = (students || []).filter((student) =>
    isOrganizationEligibleForStudent(organization, student),
  );

  const explicitStudents = (memberships || [])
    .map((membership) => membership.students)
    .filter(Boolean);

  return uniqueById([...derivedStudents, ...explicitStudents]).sort((a, b) =>
    `${a.last_name || ""} ${a.first_name || ""}`.localeCompare(
      `${b.last_name || ""} ${b.first_name || ""}`,
    ),
  );
}
