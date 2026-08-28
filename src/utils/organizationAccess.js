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
  if (organization.organization_type === "non_departmental") return true;
  return organizationCoversStudentProgram(organization, student.program);
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
    .select("id, name, organization_type")
    .order("name", { ascending: true });

  if (error) {
    console.error("Failed to load organization catalog:", error);
    return [];
  }

  const organizations = await attachProgramCoverage(data || []);
  return setCachedValue("organization-catalog", organizations);
}

export async function getStudentExplicitOrganizations(studentId) {
  if (!studentId) return [];

  const cacheKey = `student-memberships:${studentId}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("student_organizations")
    .select(`
      organization_id,
      role,
      organizations (
        id,
        name,
        organization_type
      )
    `)
    .eq("student_id", studentId);

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

export async function syncStudentOrganizationMemberships({
  studentId,
  program,
  explicitOrganizationIds = [],
}) {
  if (!studentId) return { error: null, organizationIds: [] };

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
    return { error: null, organizationIds: [] };
  }

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

  return { error, organizationIds };
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
      .select("id, student_number, first_name, last_name, program, year_level, status")
      .order("last_name", { ascending: true }),
    supabase
      .from("student_organizations")
      .select(`
        student_id,
        students (
          id,
          student_number,
          first_name,
          last_name,
          program,
          year_level,
          status
        )
      `)
      .eq("organization_id", organizationId),
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
