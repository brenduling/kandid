import {
  BarChart3,
  Building2,
  FileText,
  ListChecks,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Users,
  Vote,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  attachProgramCoverage,
  fetchEligibleStudentsForOrganization,
  getEligibleStudentOrganizations,
  getStudentElectionOrganizationIds,
  selectActiveMemberships,
} from "./organizationAccess";

export const SEARCH_MIN_LENGTH = 2;

export const searchCategoryMeta = {
  all: { label: "All", icon: BarChart3 },
  organizations: { label: "Organizations", icon: Building2 },
  elections: { label: "Elections", icon: Vote },
  students: { label: "Students", icon: Users },
  candidates: { label: "Candidates", icon: UserCheck },
  officers: { label: "Officers", icon: ShieldCheck },
  partylists: { label: "Partylists", icon: ScrollText },
  positions: { label: "Positions", icon: ListChecks },
  results: { label: "Results", icon: BarChart3 },
  reports: { label: "Reports", icon: FileText },
  audit_logs: { label: "Audit Logs", icon: ShieldCheck },
  programs: { label: "Programs", icon: ListChecks },
};

const categoryOrder = [
  "organizations",
  "elections",
  "students",
  "candidates",
  "officers",
  "partylists",
  "positions",
  "results",
  "reports",
  "audit_logs",
  "programs",
];

const roleCategories = {
  student: ["programs", "organizations", "students", "elections", "candidates", "officers", "results"],
  electoral_board: [
    "programs",
    "students",
    "elections",
    "candidates",
    "positions",
    "officers",
    "partylists",
    "results",
    "reports",
  ],
  super_admin: [
    "programs",
    "organizations",
    "students",
    "elections",
    "candidates",
    "positions",
    "officers",
    "partylists",
    "results",
    "reports",
    "audit_logs",
  ],
};

const SEARCH_HISTORY_LIMIT = 15;

function historyKey(role) {
  return `kandid-search-history-${role || "guest"}`;
}

export function normalizeSearchInput(value) {
  return String(value || "").trim().toLowerCase();
}

export function getRoleSearchPath(role) {
  if (role === "student") return "/student/search";
  if (role === "electoral_board") return "/board/search";
  if (role === "super_admin") return "/super-admin/search";
  return "/";
}

export function getRoleSearchCategories(role) {
  return roleCategories[role] || [];
}

function fullName(student = {}) {
  return [student.first_name, student.last_name].filter(Boolean).join(" ").trim();
}

function programText(organization = {}) {
  return (organization.organization_programs || [])
    .map((link) => link?.programs?.code || link?.programs?.name)
    .filter(Boolean)
    .join(", ");
}

function matchesQuery(fields, query) {
  const cleaned = normalizeSearchInput(query);
  if (!cleaned) return true;
  return fields.some((field) => normalizeSearchInput(field).includes(cleaned));
}

function extractYearTerms(value) {
  const text = String(value || "");
  return Array.from(new Set(text.match(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\b/g) || []))
    .map((term) => term.replace(/\s+/g, ""));
}

function matchesYearFilter(record, year) {
  const cleanedYear = String(year || "").trim();
  if (!cleanedYear) return true;
  const fields = [record.term_label, record.term_start, record.term_end];
  return fields.some((field) => normalizeSearchInput(field).includes(normalizeSearchInput(cleanedYear)));
}

function officerSearchTerms(query) {
  return normalizeSearchInput(query)
    .replace(/\bofficers?\b/g, "")
    .replace(/\bcurrent\b/g, "")
    .replace(/\bprevious\b/g, "")
    .replace(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\b/g, "")
    .trim();
}

function scoreResult(result, query) {
  const cleaned = normalizeSearchInput(query);
  const title = normalizeSearchInput(result.title);
  const subtitle = normalizeSearchInput(result.subtitle);
  const meta = normalizeSearchInput(result.meta);

  if (!cleaned) return 0;
  if (title === cleaned) return 0;
  if (title.startsWith(cleaned)) return 1;
  if (title.includes(cleaned)) return 2;
  if (subtitle.includes(cleaned)) return 3;
  if (meta.includes(cleaned)) return 4;
  return 5;
}

function sortResults(results, query) {
  return [...results].sort((a, b) => {
    const scoreDelta = scoreResult(a, query) - scoreResult(b, query);
    if (scoreDelta !== 0) return scoreDelta;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function rolePrefix(role) {
  if (role === "student") return "/student";
  if (role === "electoral_board") return "/board";
  return "/super-admin";
}

function resultHref(role, category, id, query) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("type", category);
  params.set("id", String(id));
  return `${rolePrefix(role)}/search?${params.toString()}`;
}

function resultBase(role, category, record, query) {
  return {
    id: String(record.id),
    category,
    type: searchCategoryMeta[category]?.label || category,
    href: resultHref(role, category, record.id, query),
  };
}

function organizationResult(record, role, query) {
  const programs = programText(record);
  const memberCount = record.member_count ?? 0;
  const typeLabel =
    record.organization_type === "non_departmental"
      ? "Non-departmental"
      : "Departmental";
  const description =
    record.description || "No organization description has been added yet.";

  return {
    ...resultBase(role, "organizations", record, query),
    title: record.name || "Organization",
    subtitle: ["Organization", typeLabel, programs].filter(Boolean).join(" - "),
    meta: description,
    image: record.logo_url,
    imageFit: "contain",
    fields: [
      ["Type", typeLabel],
      ["Programs", programs],
      ["Members", memberCount],
      ["Description", record.description],
    ],
    sections: [
      {
        title: "Overview",
        fields: [
          ["Type", record.organization_type === "non_departmental" ? "Non-departmental" : "Departmental"],
          ["Programs", programs || "No mapped programs"],
          ["Member Count", memberCount],
        ],
      },
      {
        title: "About",
        fields: [["Description", description]],
      },
    ],
    related: [],
  };
}

function programResult(record, role, query) {
  const organizations = (record.organization_programs || [])
    .map((link) => link?.organizations?.name)
    .filter(Boolean);

  return {
    ...resultBase(role, "programs", record, query),
    title: record.code || record.name || "Program",
    subtitle: record.name || "Academic program",
    meta: `${record.student_count ?? 0} students`,
    fields: [
      ["Code", record.code],
      ["Program Name", record.name],
      ["Students", record.student_count ?? 0],
      ["Organizations", organizations.join(", ")],
    ],
    sections: [
      {
        title: "Program Overview",
        fields: [
          ["Code", record.code],
          ["Program Name", record.name || "No full program name recorded"],
          ["Student Count", record.student_count ?? 0],
        ],
      },
      {
        title: "Organizations",
        fields: [["Mapped Organizations", organizations.join(", ") || "No organizations mapped to this program"]],
      },
    ],
    related: organizations.length
      ? (record.organization_programs || [])
          .map((link) => link?.organizations)
          .filter(Boolean)
          .map((org) => ({ label: org.name, href: resultHref(role, "organizations", org.id, query) }))
      : [],
  };
}

function electionResult(record, role, query) {
  const organizationName = record.organizations?.name || "Organization";
  return {
    ...resultBase(role, "elections", record, query),
    title: record.title || "Election",
    subtitle: `Election - ${organizationName}`,
    meta: [record.status, record.start_date && `Starts ${new Date(record.start_date).toLocaleString()}`]
      .filter(Boolean)
      .join(" - "),
    image: record.organizations?.logo_url,
    imageFit: "contain",
    fields: [
      ["Organization", organizationName],
      ["Status", record.status],
      ["Campaign Starts", formatDate(record.campaign_start)],
      ["Voting Starts", formatDate(record.start_date)],
      ["Voting Ends", formatDate(record.end_date)],
      ["Results", resultVisibilityLabel(record.student_result_visibility)],
    ],
    sections: [
      {
        title: "Election Overview",
        fields: [
          ["Organization", organizationName],
          ["Status", record.status],
          ["Result Visibility", resultVisibilityLabel(record.student_result_visibility)],
        ],
      },
      {
        title: "Schedule",
        fields: [
          ["Campaign Starts", formatDate(record.campaign_start)],
          ["Voting Starts", formatDate(record.start_date)],
          ["Voting Ends", formatDate(record.end_date)],
        ],
      },
    ],
    related: record.organization_id
      ? [{ label: organizationName, href: resultHref(role, "organizations", record.organization_id, query) }]
      : [],
  };
}

function studentResult(record, role, query) {
  const badges = [
    record.current_officer_role,
    record.past_officer_role,
    record.candidate_role,
  ].filter(Boolean);
  const publicContext = [record.program, record.year_level && `Year ${record.year_level}`, ...badges]
    .filter(Boolean)
    .join(" - ");

  return {
    ...resultBase(role, "students", record, query),
    title: fullName(record) || record.student_number || "Student",
    subtitle: ["Student", publicContext].filter(Boolean).join(" - "),
    meta: role === "student" ? publicContext || "Student profile" : record.student_number || publicContext,
    image: record.photo_url,
    imageFit: "cover",
    badges,
    fields: [
      ["Student Number", role === "student" ? null : record.student_number],
      ["Program", record.program],
      ["Year Level", record.year_level],
      ["Current Officer Role", record.current_officer_role],
      ["Previous Officer Role", record.past_officer_role],
      ["Candidate Role", record.candidate_role],
      ["Status", role === "student" ? null : record.status],
    ],
    sections: [
      {
        title: "Academic Information",
        fields: [
          ["Program", record.program],
          ["Year Level", record.year_level],
        ],
      },
      ...(badges.length
        ? [
            {
              title: "Public Roles",
              fields: [
                ["Current Officer", record.current_officer_role],
                ["Previous Officer", record.past_officer_role],
                ["Candidate", record.candidate_role],
              ],
            },
          ]
        : []),
      ...(role === "student"
        ? []
        : [
            {
              title: "Account Record",
              fields: [
                ["Student Number", record.student_number],
                ["Status", record.status],
              ],
            },
          ]),
    ],
    related: [],
  };
}

function candidateResult(record, role, query) {
  const studentName = fullName(record.students) || "Candidate";
  const election = record.positions?.elections;
  return {
    ...resultBase(role, "candidates", record, query),
    title: studentName,
    subtitle: ["Candidate", record.positions?.name, election?.title].filter(Boolean).join(" - "),
    meta: [record.partylists?.name, record.platform].filter(Boolean).join(" - "),
    image: record.photo || record.students?.photo_url,
    imageFit: "cover",
    fields: [
      ["Position", record.positions?.name],
      ["Election", election?.title],
      ["Organization", election?.organizations?.name],
      ["Partylist", record.partylists?.name],
      ["Program", record.students?.program],
      ["Year Level", record.students?.year_level],
      ["Platform", record.platform],
      ["Biography", record.bio],
    ],
    sections: [
      {
        title: "Candidacy",
        fields: [
          ["Position", record.positions?.name],
          ["Election", election?.title],
          ["Organization", election?.organizations?.name],
          ["Partylist", record.partylists?.name || "Independent / not specified"],
        ],
      },
      {
        title: "Student Information",
        fields: [
          ["Program", record.students?.program],
          ["Year Level", record.students?.year_level],
        ],
      },
      {
        title: "Campaign",
        fields: [
          ["Platform", record.platform],
          ["Biography", record.bio],
        ],
      },
    ],
    related: election?.id
      ? [{ label: election.title, href: resultHref(role, "elections", election.id, query) }]
      : [],
  };
}

function officerResult(record, role, query) {
  const name = record.officer_name || fullName(record.students) || "Officer";
  return {
    ...resultBase(role, "officers", record, query),
    title: name,
    subtitle: ["Officer", record.position_title, record.organizations?.name].filter(Boolean).join(" - "),
    meta: [record.term_label, record.is_current ? "Current" : "Previous"].filter(Boolean).join(" - "),
    image: record.photo_url || record.students?.photo_url,
    imageFit: "cover",
    badges: [record.is_current ? "Current Officer" : "Past Officer", record.position_title].filter(Boolean),
    fields: [
      ["Position", record.position_title],
      ["Organization", record.organizations?.name],
      ["Term", record.term_label],
      ["Status", record.is_current ? "Current officer" : "Previous officer"],
      ["Program", record.students?.program],
      ["Year Level", record.students?.year_level],
    ],
    sections: [
      {
        title: "Officer Role",
        fields: [
          ["Position", record.position_title],
          ["Organization", record.organizations?.name],
          ["Term", record.term_label],
          ["Status", record.is_current ? "Current officer" : "Previous officer"],
        ],
      },
      {
        title: "Academic Information",
        fields: [
          ["Program", record.students?.program],
          ["Year Level", record.students?.year_level],
        ],
      },
    ],
    related: record.organization_id
      ? [{ label: record.organizations?.name, href: resultHref(role, "organizations", record.organization_id, query) }]
      : [],
  };
}

function partylistResult(record, role, query) {
  return {
    ...resultBase(role, "partylists", record, query),
    title: record.name || "Partylist",
    subtitle: ["Partylist", record.elections?.title, record.elections?.organizations?.name]
      .filter(Boolean)
      .join(" - "),
    meta: record.description || "Election partylist",
    image: record.logo_url,
    imageFit: "contain",
    fields: [
      ["Election", record.elections?.title],
      ["Organization", record.elections?.organizations?.name],
      ["Description", record.description],
    ],
    related: record.election_id
      ? [{ label: record.elections?.title, href: resultHref(role, "elections", record.election_id, query) }]
      : [],
  };
}

function positionResult(record, role, query) {
  return {
    ...resultBase(role, "positions", record, query),
    title: record.name || "Position",
    subtitle: ["Position", record.elections?.title, record.elections?.organizations?.name]
      .filter(Boolean)
      .join(" - "),
    meta: `Maximum votes: ${record.max_votes || 1}`,
    fields: [
      ["Election", record.elections?.title],
      ["Organization", record.elections?.organizations?.name],
      ["Maximum Votes", record.max_votes || 1],
    ],
    related: record.election_id
      ? [{ label: record.elections?.title, href: resultHref(role, "elections", record.election_id, query) }]
      : [],
  };
}

function resultResult(record, role, query) {
  return {
    ...resultBase(role, "results", record, query),
    title: record.title || "Election Results",
    subtitle: ["Results", record.organizations?.name].filter(Boolean).join(" - "),
    meta: resultVisibilityLabel(record.student_result_visibility),
    fields: [
      ["Election", record.title],
      ["Organization", record.organizations?.name],
      ["Status", record.status],
      ["Result Visibility", resultVisibilityLabel(record.student_result_visibility)],
    ],
    related: [{ label: record.title, href: resultHref(role, "elections", record.id, query) }],
  };
}

function reportResult(record, role, query) {
  return {
    ...resultBase(role, "reports", record, query),
    title: record.title || "Election Report",
    subtitle: ["Report", record.organizations?.name].filter(Boolean).join(" - "),
    meta: [record.status, formatDate(record.end_date)].filter(Boolean).join(" - "),
    fields: [
      ["Election", record.title],
      ["Organization", record.organizations?.name],
      ["Status", record.status],
      ["Voting Ends", formatDate(record.end_date)],
    ],
    related: [{ label: record.title, href: resultHref(role, "elections", record.id, query) }],
  };
}

function auditLogResult(record, role, query) {
  return {
    ...resultBase(role, "audit_logs", record, query),
    title: record.action || "Audit log",
    subtitle: "Audit Log",
    meta: formatDate(record.timestamp),
    fields: [
      ["Action", record.action],
      ["Timestamp", formatDate(record.timestamp)],
      ["User ID", record.user_id || "System"],
    ],
    related: [],
  };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : null;
}

function resultVisibilityLabel(value) {
  if (value === "after_close") return "Visible after close";
  if (value === "public") return "Visible";
  return "Hidden until released";
}

async function queryOrganizations(user, query, role, limit) {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, description, logo_url, organization_type, created_at")
    .order("name", { ascending: true })
    .limit(120);

  if (error) throw error;

  const rows = await attachProgramCoverage(data || []);

  const filteredRows = rows
    .filter((org) => matchesQuery([org.name, org.description, org.organization_type, programText(org)], query))
    .slice(0, limit);

  const countedRows = await Promise.all(
    filteredRows.map(async (org) => ({
      ...org,
      member_count: await countOrganizationMembers(org.id),
    })),
  );

  return sortResults(
    countedRows.map((org) => organizationResult(org, role, query)),
    query,
  );
}

async function countStudentsForProgram(programCode) {
  if (!programCode) return 0;
  const { count, error } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("program", programCode);
  if (error) return 0;
  return count || 0;
}

async function countOrganizationMembers(organizationId) {
  if (!organizationId) return 0;
  const { count, error } = await selectActiveMemberships(
    "student_id",
    [["organization_id", organizationId]],
    { count: "exact", head: true },
  );
  if (error) return 0;
  return count || 0;
}

async function queryPrograms(user, query, role, limit) {
  let request = supabase
    .from("programs")
    .select("id, code, name, organization_programs(organization_id, organizations(id, name))")
    .order("code", { ascending: true })
    .limit(60);

  const { data, error } = await request;
  if (error) throw error;

  let rows = data || [];

  if (role === "student") {
    rows = rows.filter((program) => normalizeSearchInput(program.code) === normalizeSearchInput(user?.program));
  } else if (role === "electoral_board") {
    rows = rows.filter((program) =>
      (program.organization_programs || []).some(
        (link) => String(link.organization_id) === String(user?.organization_id),
      ),
    );
  }

  const filteredRows = rows
    .filter((program) => matchesQuery([program.code, program.name], query))
    .slice(0, limit);

  const countedRows = await Promise.all(
    filteredRows.map(async (program) => ({
      ...program,
      student_count: await countStudentsForProgram(program.code),
    })),
  );

  return sortResults(
    countedRows.map((program) => programResult(program, role, query)),
    query,
  );
}

async function queryElections(user, query, role, limit) {
  let request = supabase
    .from("elections")
    .select(
      "id, title, organization_id, campaign_start, campaign_end, start_date, end_date, status, student_result_visibility, organizations(id, name, logo_url)",
    )
    .order("start_date", { ascending: false })
    .limit(90);

  if (role === "student") {
    const ids = await getStudentElectionOrganizationIds(user);
    if (ids.length === 0) return [];
    request = request.in("organization_id", ids);
  } else if (role === "electoral_board") {
    if (!user?.organization_id) return [];
    request = request.eq("organization_id", user.organization_id);
  }

  const { data, error } = await request;
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((election) =>
        matchesQuery([election.title, election.status, election.organizations?.name], query),
      )
      .map((election) => electionResult(election, role, query)),
    query,
  ).slice(0, limit);
}

async function queryStudents(user, query, role, limit) {
  let rows = [];
  if (role === "electoral_board") {
    rows = await fetchEligibleStudentsForOrganization(user?.organization_id);
  } else {
    const selectFields =
      role === "student"
        ? "id, first_name, last_name, photo_url, program, year_level, status"
        : "id, student_number, first_name, last_name, photo_url, program, year_level, status";

    const { data, error } = await supabase
      .from("students")
      .select(selectFields)
      .order("last_name", { ascending: true })
      .limit(120);
    if (error) throw error;
    rows = data || [];
  }

  const filteredStudents = rows
    .filter((student) =>
      matchesQuery(
        [
          fullName(student),
          role === "student" ? null : student.student_number,
          student.program,
          student.year_level,
        ],
        query,
      ),
    )
    .slice(0, limit);

  const enrichedStudents = await attachPublicStudentRoles(filteredStudents);

  return sortResults(
    enrichedStudents.map((student) => studentResult(student, role, query)),
    query,
  ).slice(0, limit);
}

async function attachPublicStudentRoles(students = []) {
  const studentIds = students.map((student) => student.id).filter(Boolean);
  if (studentIds.length === 0) return students;

  const [officerResultRows, candidateResultRows] = await Promise.allSettled([
    supabase
      .from("officers")
      .select("student_id, position_title, term_label, is_current, organizations(name)")
      .in("student_id", studentIds)
      .order("is_current", { ascending: false })
      .limit(120),
    supabase
      .from("candidates")
      .select("student_id, positions(name, elections(title, organizations(name)))")
      .in("student_id", studentIds)
      .limit(120),
  ]);

  const officersByStudent = new Map();
  if (officerResultRows.status === "fulfilled" && !officerResultRows.value.error) {
    (officerResultRows.value.data || []).forEach((officer) => {
      const current = officersByStudent.get(officer.student_id) || {
        current: null,
        past: null,
      };

      if (officer.is_current && !current.current) {
        current.current = officer;
      } else if (!officer.is_current && !current.past) {
        current.past = officer;
      }

      officersByStudent.set(officer.student_id, current);
    });
  }

  const candidatesByStudent = new Map();
  if (candidateResultRows.status === "fulfilled" && !candidateResultRows.value.error) {
    (candidateResultRows.value.data || []).forEach((candidate) => {
      if (!candidatesByStudent.has(candidate.student_id)) {
        candidatesByStudent.set(candidate.student_id, candidate);
      }
    });
  }

  return students.map((student) => {
    const officerRoles = officersByStudent.get(student.id) || {};
    const candidate = candidatesByStudent.get(student.id);
    const currentOfficer = officerRoles.current;
    const pastOfficer = officerRoles.past;

    return {
      ...student,
      current_officer_role: currentOfficer
        ? [currentOfficer.position_title || "Officer", currentOfficer.organizations?.name]
            .filter(Boolean)
            .join(" - ")
        : null,
      past_officer_role: pastOfficer
        ? [pastOfficer.position_title || "Past Officer", pastOfficer.term_label]
            .filter(Boolean)
            .join(" - ")
        : null,
      candidate_role: candidate
        ? [
            candidate.positions?.name || "Candidate",
            candidate.positions?.elections?.organizations?.name,
          ]
            .filter(Boolean)
            .join(" - ")
        : null,
    };
  });
}

async function scopedElectionIds(user, role) {
  let request = supabase.from("elections").select("id, organization_id").limit(120);
  if (role === "student") {
    const ids = await getStudentElectionOrganizationIds(user);
    if (ids.length === 0) return [];
    request = request.in("organization_id", ids);
  } else if (role === "electoral_board") {
    if (!user?.organization_id) return [];
    request = request.eq("organization_id", user.organization_id);
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

async function queryCandidates(user, query, role, limit) {
  const electionIds = await scopedElectionIds(user, role);
  if (electionIds.length === 0) return [];

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id")
    .in("election_id", electionIds)
    .limit(160);
  if (positionsError) throw positionsError;

  const positionIds = (positions || []).map((item) => item.id).filter(Boolean);
  if (positionIds.length === 0) return [];

  const { data, error } = await supabase
    .from("candidates")
    .select(
      "id, photo, bio, platform, student_id, position_id, partylist_id, students(first_name, last_name, photo_url, program, year_level), positions(id, name, election_id, elections(id, title, organization_id, organizations(id, name))), partylists(id, name)",
    )
    .in("position_id", positionIds)
    .limit(120);
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((candidate) =>
        matchesQuery(
          [
            fullName(candidate.students),
            candidate.students?.program,
            candidate.positions?.name,
            candidate.positions?.elections?.title,
            candidate.positions?.elections?.organizations?.name,
            candidate.partylists?.name,
            candidate.platform,
          ],
          query,
        ),
      )
      .map((candidate) => candidateResult(candidate, role, query)),
    query,
  ).slice(0, limit);
}

async function queryOfficers(user, query, role, limit, options = {}) {
  let request = supabase
    .from("officers")
    .select(
      "id, organization_id, student_id, officer_name, position_title, term_label, term_start, term_end, photo_url, is_current, students(first_name, last_name, photo_url, program, year_level), organizations(id, name)",
    )
    .order("is_current", { ascending: false })
    .limit(100);

  if (role === "student") {
    const orgs = await getEligibleStudentOrganizations(user);
    const ids = orgs.map((org) => org.id).filter(Boolean);
    if (ids.length === 0) return [];
    request = request.in("organization_id", ids);
  } else if (role === "electoral_board") {
    if (!user?.organization_id) return [];
    request = request.eq("organization_id", user.organization_id);
  }

  const { data, error } = await request;
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((officer) => matchesYearFilter(officer, options.year))
      .filter((officer) =>
        matchesQuery(
          [
            officer.officer_name,
            fullName(officer.students),
            officer.position_title,
            officer.term_label,
            officer.organizations?.name,
            officer.students?.program,
          ],
          officerSearchTerms(query) || query,
        ),
      )
      .map((officer) => officerResult(officer, role, query)),
    query,
  ).slice(0, limit);
}

async function queryPartylists(user, query, role, limit) {
  if (role === "student") return [];
  const electionIds = await scopedElectionIds(user, role);
  if (electionIds.length === 0) return [];

  const { data, error } = await supabase
    .from("partylists")
    .select(
      "id, name, description, logo_url, election_id, elections(id, title, organization_id, organizations(id, name))",
    )
    .in("election_id", electionIds)
    .limit(90);
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((partylist) =>
        matchesQuery(
          [partylist.name, partylist.description, partylist.elections?.title, partylist.elections?.organizations?.name],
          query,
        ),
      )
      .map((partylist) => partylistResult(partylist, role, query)),
    query,
  ).slice(0, limit);
}

async function queryPositions(user, query, role, limit) {
  if (role === "student") return [];
  const electionIds = await scopedElectionIds(user, role);
  if (electionIds.length === 0) return [];

  const { data, error } = await supabase
    .from("positions")
    .select("id, name, election_id, max_votes, elections(id, title, organization_id, organizations(id, name))")
    .in("election_id", electionIds)
    .limit(120);
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((position) =>
        matchesQuery([position.name, position.elections?.title, position.elections?.organizations?.name], query),
      )
      .map((position) => positionResult(position, role, query)),
    query,
  ).slice(0, limit);
}

async function queryResults(user, query, role, limit) {
  const elections = await queryElections(user, query, role, 80);
  return elections
    .filter((item) => {
      const visibility = item.fields.find(([label]) => label === "Results")?.[1];
      return role !== "student" || visibility !== "Hidden until released";
    })
    .map((item) => {
      const visibility = item.fields.find(([label]) => label === "Results")?.[1];
      const organization = item.fields.find(([label]) => label === "Organization")?.[1];

      return {
        ...item,
        category: "results",
        type: "Results",
        href: resultHref(role, "results", item.id, query),
        subtitle: ["Results", organization].filter(Boolean).join(" - "),
        meta: visibility,
        fields: [
          ["Election", item.title],
          ["Organization", organization],
          ["Status", item.fields.find(([label]) => label === "Status")?.[1]],
          ["Result Visibility", visibility],
        ],
        related: [{ label: item.title, href: resultHref(role, "elections", item.id, query) }],
      };
    })
    .slice(0, limit);
}

async function queryReports(user, query, role, limit) {
  if (role === "student") return [];
  return (await queryElections(user, query, role, limit)).map((item) =>
    ({
      ...item,
      category: "reports",
      type: "Reports",
      href: resultHref(role, "reports", item.id, query),
      subtitle: ["Report", item.fields.find(([label]) => label === "Organization")?.[1]]
        .filter(Boolean)
        .join(" - "),
      meta: [item.fields.find(([label]) => label === "Status")?.[1], item.fields.find(([label]) => label === "Voting Ends")?.[1]]
        .filter(Boolean)
        .join(" - "),
      related: [{ label: item.title, href: resultHref(role, "elections", item.id, query) }],
    }),
  );
}

async function queryAuditLogs(_user, query, role, limit) {
  if (role !== "super_admin") return [];

  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, timestamp")
    .order("timestamp", { ascending: false })
    .limit(100);
  if (error) throw error;

  return sortResults(
    (data || [])
      .filter((log) => matchesQuery([log.action, log.timestamp, log.user_id], query))
      .map((log) => auditLogResult(log, role, query)),
    query,
  ).slice(0, limit);
}

const loaders = {
  organizations: queryOrganizations,
  elections: queryElections,
  students: queryStudents,
  candidates: queryCandidates,
  officers: queryOfficers,
  partylists: queryPartylists,
  positions: queryPositions,
  results: queryResults,
  reports: queryReports,
  audit_logs: queryAuditLogs,
  programs: queryPrograms,
};

export async function searchKandid(user, rawQuery, options = {}) {
  const role = user?.role;
  const query = normalizeSearchInput(rawQuery);
  const categories = getRoleSearchCategories(role);
  const perCategoryLimit = options.perCategoryLimit || 8;
  const searchOptions = {
    ...options,
    year: options.year || extractYearTerms(query)[0] || "",
  };

  if (!role || query.length < SEARCH_MIN_LENGTH) {
    return { query, categories, groups: {}, all: [], errors: [] };
  }

  const settled = await Promise.allSettled(
    categories.map(async (category) => {
      const items = await loaders[category](user, query, role, perCategoryLimit, searchOptions);
      return [category, items];
    }),
  );

  const groups = {};
  const errors = [];

  settled.forEach((entry, index) => {
    const category = categories[index];
    if (entry.status === "fulfilled") {
      groups[entry.value[0]] = entry.value[1];
    } else {
      groups[category] = [];
      errors.push({ category, message: entry.reason?.message || "Search failed." });
    }
  });

  const all = sortResults(
    categoryOrder.flatMap((category) => groups[category] || []),
    query,
  );

  return { query, categories, groups, all, errors };
}

export function findSearchResult(searchData, category, id) {
  if (!searchData || !category || !id) return null;
  return (searchData.groups?.[category] || []).find((item) => String(item.id) === String(id)) || null;
}

export function getSearchHistory(role) {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey(role)) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, SEARCH_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(role, query, category = "all") {
  const cleaned = String(query || "").trim();
  if (normalizeSearchInput(cleaned).length < SEARCH_MIN_LENGTH) return [];

  const key = historyKey(role);
  const current = getSearchHistory(role).filter(
    (item) =>
      normalizeSearchInput(item.query) !== normalizeSearchInput(cleaned) ||
      String(item.category || "all") !== String(category || "all"),
  );
  const next = [
    {
      query: cleaned,
      category: category || "all",
      timestamp: Date.now(),
    },
    ...current,
  ].slice(0, SEARCH_HISTORY_LIMIT);

  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kandid-search-history-updated", { detail: { role } }));
  return next;
}

export function removeSearchHistoryItem(role, query, category = "all") {
  const next = getSearchHistory(role).filter(
    (item) =>
      normalizeSearchInput(item.query) !== normalizeSearchInput(query) ||
      String(item.category || "all") !== String(category || "all"),
  );
  localStorage.setItem(historyKey(role), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kandid-search-history-updated", { detail: { role } }));
  return next;
}

export function clearSearchHistory(role) {
  localStorage.removeItem(historyKey(role));
  window.dispatchEvent(new CustomEvent("kandid-search-history-updated", { detail: { role } }));
}

export function getOfficerYearOptions(searchData) {
  return Array.from(
    new Set(
      (searchData?.groups?.officers || [])
        .flatMap((officer) => [
          ...(officer.fields || [])
            .filter(([label]) => label === "Term")
            .flatMap(([, value]) => extractYearTerms(value)),
        ])
        .filter(Boolean),
    ),
  ).sort((a, b) => b.localeCompare(a));
}
