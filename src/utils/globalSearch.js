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
];

const roleCategories = {
  student: ["organizations", "elections", "candidates", "officers", "results"],
  electoral_board: [
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
  return {
    ...resultBase(role, "organizations", record, query),
    title: record.name || "Organization",
    subtitle:
      record.organization_type === "non_departmental"
        ? "Organization - Non-departmental"
        : `Organization - ${programs || "Departmental"}`,
    meta: record.description || programs || "Organization profile",
    image: record.logo_url,
    fields: [
      ["Type", record.organization_type === "non_departmental" ? "Non-departmental" : "Departmental"],
      ["Programs", programs],
      ["Description", record.description],
    ],
    related: [],
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
    fields: [
      ["Organization", organizationName],
      ["Status", record.status],
      ["Campaign Starts", formatDate(record.campaign_start)],
      ["Voting Starts", formatDate(record.start_date)],
      ["Voting Ends", formatDate(record.end_date)],
      ["Results", resultVisibilityLabel(record.student_result_visibility)],
    ],
    related: record.organization_id
      ? [{ label: organizationName, href: resultHref(role, "organizations", record.organization_id, query) }]
      : [],
  };
}

function studentResult(record, role, query) {
  return {
    ...resultBase(role, "students", record, query),
    title: fullName(record) || record.student_number || "Student",
    subtitle: ["Student", record.program, record.year_level && `Year ${record.year_level}`]
      .filter(Boolean)
      .join(" - "),
    meta: role === "student" ? record.program || "Student profile" : record.student_number || record.program,
    image: record.photo_url,
    fields: [
      ["Student Number", role === "student" ? null : record.student_number],
      ["Program", record.program],
      ["Year Level", record.year_level],
      ["Status", role === "student" ? null : record.status],
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
    fields: [
      ["Position", record.position_title],
      ["Organization", record.organizations?.name],
      ["Term", record.term_label],
      ["Status", record.is_current ? "Current officer" : "Previous officer"],
      ["Program", record.students?.program],
      ["Year Level", record.students?.year_level],
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
  let rows = [];

  if (role === "student") {
    rows = await getEligibleStudentOrganizations(user);
  } else {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, description, logo_url, organization_type, created_at")
      .order("name", { ascending: true })
      .limit(80);
    if (error) throw error;
    rows = await attachProgramCoverage(data || []);
  }

  return sortResults(
    rows
      .filter((org) => matchesQuery([org.name, org.description, org.organization_type, programText(org)], query))
      .map((org) => organizationResult(org, role, query)),
    query,
  ).slice(0, limit);
}

async function queryElections(user, query, role, limit) {
  let request = supabase
    .from("elections")
    .select(
      "id, title, organization_id, campaign_start, campaign_end, start_date, end_date, status, student_result_visibility, organizations(id, name)",
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
  if (role === "student") return [];

  let rows = [];
  if (role === "electoral_board") {
    rows = await fetchEligibleStudentsForOrganization(user?.organization_id);
  } else {
    const { data, error } = await supabase
      .from("students")
      .select("id, student_number, first_name, last_name, photo_url, program, year_level, status")
      .order("last_name", { ascending: true })
      .limit(120);
    if (error) throw error;
    rows = data || [];
  }

  return sortResults(
    rows
      .filter((student) =>
        matchesQuery([fullName(student), student.student_number, student.program, student.year_level], query),
      )
      .map((student) => studentResult(student, role, query)),
    query,
  ).slice(0, limit);
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

async function queryOfficers(user, query, role, limit) {
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
          query,
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
};

export async function searchKandid(user, rawQuery, options = {}) {
  const role = user?.role;
  const query = normalizeSearchInput(rawQuery);
  const categories = getRoleSearchCategories(role);
  const perCategoryLimit = options.perCategoryLimit || 8;

  if (!role || query.length < SEARCH_MIN_LENGTH) {
    return { query, categories, groups: {}, all: [], errors: [] };
  }

  const settled = await Promise.allSettled(
    categories.map(async (category) => {
      const items = await loaders[category](user, query, role, perCategoryLimit);
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
