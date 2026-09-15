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

function getStoredStudentCredentials(student) {
  let storedUser;
  try {
    storedUser = JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    storedUser = null;
  }

  return {
    student_number: student?.student_number || storedUser?.student_number || "",
    password: student?.password || storedUser?.password || "",
  };
}

const REQUIRED_STUDENT_ORGANIZATION_NAMES = [
  "WITSG",
  "WIT-SG",
  "WIT SG",
  "Western Institute of Technology Student Government",
];

export function activeMembershipQuery(query) {
  return query;
}

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

export async function selectOrganizationMembershipsForManagement(organizationId, options = {}) {
  if (!organizationId) return { data: [], error: null, count: 0 };

  const {
    page = 1,
    pageSize,
    search = "",
    sortBy = "newest",
  } = options;

  const studentSelect = `
    id,
    student_number,
    first_name,
    last_name,
    email,
    program,
    year_level,
    status,
    created_at
  `;

  const normalizedSearch = search.trim();
  const from = pageSize ? Math.max(0, (Math.max(1, page) - 1) * pageSize) : 0;
  const to = pageSize ? from + pageSize - 1 : undefined;

  if (!normalizedSearch) {
    let membershipPageQuery = supabase
      .from("student_organizations")
      .select(
        `
    student_id,
    organization_id,
    role
  `,
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("student_id", { ascending: sortBy === "id_asc" });

    if (pageSize) {
      membershipPageQuery = membershipPageQuery.range(from, to);
    }

    const {
      data: pageMemberships,
      error: pageMembershipError,
      count,
    } = await membershipPageQuery;

    if (pageMembershipError) {
      return { data: [], error: pageMembershipError, count: 0 };
    }

    const pageStudentIds = [
      ...new Set((pageMemberships || []).map((membership) => membership.student_id).filter(Boolean)),
    ];

    if (pageStudentIds.length === 0) {
      return { data: [], error: null, count: count || 0 };
    }

    const { data: pageStudents, error: pageStudentError } = await supabase
      .from("students")
      .select(studentSelect)
      .in("id", pageStudentIds);

    if (pageStudentError) {
      return { data: [], error: pageStudentError, count: 0 };
    }

    const studentsById = new Map((pageStudents || []).map((student) => [Number(student.id), student]));

    return {
      data: (pageMemberships || []).map((membership) => ({
        ...membership,
        students: studentsById.get(Number(membership.student_id)) || null,
        membership_status: "active",
      })),
      error: null,
      count: count || 0,
    };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("student_organizations")
    .select(
      `
    student_id,
    organization_id,
    role
  `,
    )
    .eq("organization_id", organizationId);

  if (membershipError) {
    return { data: [], error: membershipError, count: 0 };
  }

  const studentIds = [...new Set((memberships || []).map((membership) => membership.student_id).filter(Boolean))];
  if (studentIds.length === 0) return { data: [], error: null, count: 0 };

  let studentQuery = supabase
    .from("students")
    .select(studentSelect, { count: "exact" })
    .in("id", studentIds);

  if (normalizedSearch) {
    const term = normalizedSearch.replaceAll("%", "\\%").replaceAll("_", "\\_");
    studentQuery = studentQuery.or(
      [
        `student_number.ilike.%${term}%`,
        `first_name.ilike.%${term}%`,
        `last_name.ilike.%${term}%`,
        `email.ilike.%${term}%`,
        `program.ilike.%${term}%`,
      ].join(","),
    );
  }

  if (sortBy === "name_desc") {
    studentQuery = studentQuery.order("last_name", { ascending: false }).order("first_name", { ascending: false });
  } else if (sortBy === "oldest") {
    studentQuery = studentQuery.order("created_at", { ascending: true }).order("id", { ascending: true });
  } else if (sortBy === "id_desc") {
    studentQuery = studentQuery.order("student_number", { ascending: false }).order("id", { ascending: true });
  } else if (sortBy === "id_asc") {
    studentQuery = studentQuery.order("student_number", { ascending: true }).order("id", { ascending: true });
  } else if (sortBy === "newest") {
    studentQuery = studentQuery.order("created_at", { ascending: false }).order("id", { ascending: true });
  } else {
    studentQuery = studentQuery.order("last_name", { ascending: true }).order("first_name", { ascending: true });
  }

  if (pageSize) {
    studentQuery = studentQuery.range(from, to);
  }

  const { data: students, error: studentError, count } = await studentQuery;

  if (studentError) {
    return { data: [], error: studentError, count: 0 };
  }

  const membershipsByStudentId = new Map();
  (memberships || []).forEach((membership) => {
    const id = Number(membership.student_id);
    if (!membershipsByStudentId.has(id)) {
      membershipsByStudentId.set(id, membership);
    }
  });

  return {
    data: (students || []).map((student) => {
      const membership = membershipsByStudentId.get(Number(student.id)) || {
        student_id: student.id,
        organization_id: Number(organizationId),
        role: "member",
      };

      return {
        ...membership,
        students: student,
        membership_status: membership.membership_status || "active",
      };
    }),
    error: null,
    count: count || 0,
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
  clearCachedValue("required-student-organization-ids");
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

async function getRequiredStudentOrganizationIds() {
  const cached = getCachedValue("required-student-organization-ids");
  if (cached) return cached;

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .in("name", REQUIRED_STUDENT_ORGANIZATION_NAMES);

  if (error) {
    console.warn("Required student organization lookup failed:", error.message);
    return setCachedValue("required-student-organization-ids", []);
  }

  return setCachedValue(
    "required-student-organization-ids",
    (data || []).map((organization) => Number(organization.id)).filter(Boolean),
  );
}

async function getProgramCoveredOrganizationIds(program) {
  const normalizedProgram = normalizeProgram(program);
  if (!normalizedProgram) return [];

  const { data: programRecord, error: programError } =
    await ensureProgram(normalizedProgram);

  if (programError || !programRecord?.id) {
    if (programError) {
      console.warn("Program lookup failed for membership sync:", programError.message);
    }
    return [];
  }

  const { data, error } = await supabase
    .from("organization_programs")
    .select("organization_id")
    .eq("program_id", programRecord.id);

  if (error) {
    if (isMissingSchemaError(error)) {
      setCachedValue("organization-program-schema-missing", true);
      return [];
    }

    console.warn("Program organization lookup failed:", error.message);
    return [];
  }

  return [
    ...new Set(
      (data || [])
        .map((link) => Number(link.organization_id))
        .filter(Boolean),
    ),
  ];
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

export async function getStudentElectionOrganizationIds(student) {
  if (!student?.id) return [];

  const credentials = getStoredStudentCredentials(student);
  if (!credentials.student_number || !credentials.password) {
    const [explicitMemberships, organizations] = await Promise.all([
      getStudentExplicitOrganizations(student.id),
      getOrganizationCatalog(),
    ]);
    const derivedOrganizationIds = (organizations || [])
      .filter((organization) => isOrganizationEligibleForStudent(organization, student))
      .map((organization) => Number(organization.id));

    return [
      ...new Set(
        [
          ...(explicitMemberships || []).map((membership) =>
            Number(membership.organization_id || membership.organizations?.id),
          ),
          ...derivedOrganizationIds,
        ].filter(Boolean),
      ),
    ];
  }

  const { data, error } = await supabase.functions.invoke("organization-eligibility", {
    body: {
      action: "student_organization_ids",
      student_number: credentials.student_number,
      password: credentials.password,
    },
  });

  if (error) {
    console.error("Failed to load current-term organization eligibility:", error);
    return [];
  }

  return [
    ...new Set(
      (data?.data?.organization_ids || [])
        .map((organizationId) => Number(organizationId))
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

  const [requiredIds, derivedIds] = await Promise.all([
    getRequiredStudentOrganizationIds(),
    getProgramCoveredOrganizationIds(program),
  ]);

  const organizationIds = [
    ...new Set(
      [...requiredIds, ...derivedIds, ...explicitOrganizationIds]
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
}) {
  if (!studentId || !organizationId) {
    return { error: new Error("Student and organization are required.") };
  }

  return { error: membershipLifecycleRequiredError() };
}

export async function reactivateStudentOrganizationMembership({
  studentId,
  organizationId,
}) {
  if (!studentId || !organizationId) {
    return { error: new Error("Student and organization are required.") };
  }

  return { error: membershipLifecycleRequiredError() };
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

  const { data, error } = await supabase.functions.invoke("organization-eligibility", {
    body: {
      action: "eligible_students_for_organization",
      organization_id: Number(organizationId),
    },
  });

  if (error) {
    throw error;
  }

  return uniqueById(data?.data?.students || []);
}
