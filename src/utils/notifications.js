import { supabase } from "../lib/supabaseClient";
import { canStudentViewResults, getElectionPhase } from "./elections";
import { isMissingResultReleaseColumn } from "./results";
import { getEligibleStudentOrganizationIds } from "./organizationAccess";

function toNotification({
  id,
  title,
  body,
  href,
  timestamp,
  tone = "default",
}) {
  return {
    id,
    title,
    body,
    href,
    tone,
    timestamp: timestamp || new Date().toISOString(),
  };
}

function getReadStorageKey(user) {
  return `kandid:notification-read:${user.role}:${user.id}`;
}

export function getReadNotifications(user) {
  try {
    return JSON.parse(localStorage.getItem(getReadStorageKey(user)) || "[]");
  } catch {
    return [];
  }
}

export function markNotificationRead(user, notificationId) {
  const items = new Set(getReadNotifications(user));
  items.add(notificationId);
  localStorage.setItem(getReadStorageKey(user), JSON.stringify([...items]));
}

export function markAllNotificationsRead(user, notifications) {
  localStorage.setItem(
    getReadStorageKey(user),
    JSON.stringify(notifications.map((item) => item.id)),
  );
}

async function buildStudentNotifications(user) {
  const organizationIds = await getEligibleStudentOrganizationIds(user);

  if (organizationIds.length === 0) {
    return [
      toNotification({
        id: "student-org-none",
        title: "No organization linked yet",
        body: "Ask your election team to assign your organization before voting opens.",
        href: "/student/profile",
        tone: "warning",
      }),
    ];
  }

  const fetchElections = (includeReleaseColumn = true) =>
    supabase
      .from("elections")
      .select(
        includeReleaseColumn
          ? `
            id,
            title,
            organization_id,
            campaign_start,
            campaign_end,
            start_date,
            end_date,
            status,
            student_result_visibility,
            results_released_at,
            organizations(name)
          `
          : `
            id,
            title,
            organization_id,
            campaign_start,
            campaign_end,
            start_date,
            end_date,
            status,
            student_result_visibility,
            organizations(name)
          `,
      )
      .in("organization_id", organizationIds)
      .neq("status", "archived")
      .order("start_date", { ascending: true });

  let [{ data: elections, error: electionsError }, { data: votes }] = await Promise.all([
    fetchElections(),
    supabase
      .from("votes")
      .select("election_id, vote_timestamp")
      .eq("student_id", user.id),
  ]);

  if (isMissingResultReleaseColumn(electionsError)) {
    const fallback = await fetchElections(false);
    elections = (fallback.data || []).map((election) => ({
      ...election,
      results_released_at: null,
    }));
  }

  const votedElectionIds = new Set((votes || []).map((vote) => vote.election_id));
  const items = [];

  for (const election of elections || []) {
    const phase = getElectionPhase(election);
    const orgName = election.organizations?.name || "your organization";

    if (phase === "campaign") {
      items.push(
        toNotification({
          id: `student-campaign-${election.id}`,
          title: `${election.title} campaign is open`,
          body: `Campaign materials for ${orgName} are now available to review before voting starts.`,
          href: `/student/elections/${election.id}/campaign`,
          timestamp: election.campaign_start,
          tone: "brand",
        }),
      );
    }

    if (phase === "voting" && !votedElectionIds.has(election.id)) {
      items.push(
        toNotification({
          id: `student-vote-${election.id}`,
          title: `${election.title} is live`,
          body: `Voting is currently open for ${orgName}. Submit your ballot before the closing date.`,
          href: `/student/vote/${election.id}`,
          timestamp: election.start_date,
          tone: "success",
        }),
      );
    }

    if (phase === "closed" && canStudentViewResults(election)) {
      items.push(
        toNotification({
          id: `student-results-${election.id}`,
          title: `${election.title} results available`,
          body: `The election team has made the results visible for students.`,
          href: `/student/results?election=${election.id}`,
          timestamp: election.end_date,
        }),
      );
    }
  }

  if ((votes || []).length > 0) {
    items.push(
      toNotification({
        id: "student-receipt",
        title: "Your vote receipt is ready",
        body: "You can review your submitted ballot records and verification hashes anytime.",
        href: "/student/receipt",
        timestamp: votes[0]?.vote_timestamp,
      }),
    );
  }

  return items;
}

async function buildBoardNotifications(user) {
  const { data: elections } = await supabase
    .from("elections")
    .select("id, title, campaign_start, campaign_end, start_date, end_date, status")
    .eq("organization_id", user.organization_id)
    .neq("status", "archived")
    .order("start_date", { ascending: true });

  const items = [];

  for (const election of elections || []) {
    const phase = getElectionPhase(election);

    if (phase === "campaign") {
      items.push(
        toNotification({
          id: `board-campaign-${election.id}`,
          title: `${election.title} campaign period is active`,
          body: "Students can currently review candidate credentials and campaign materials.",
          href: "/board/elections",
          timestamp: election.campaign_start,
          tone: "brand",
        }),
      );
    }

    if (phase === "voting") {
      items.push(
        toNotification({
          id: `board-voting-${election.id}`,
          title: `${election.title} is now accepting votes`,
          body: "Monitor turnout and verify the live election flow from the board dashboard.",
          href: "/board/voting-monitor",
          timestamp: election.start_date,
          tone: "success",
        }),
      );
    }
  }

  if (items.length === 0) {
    items.push(
      toNotification({
        id: "board-empty",
        title: "No urgent board alerts",
        body: "Your current organization does not have an active campaign or voting window right now.",
        href: "/board/dashboard",
      }),
    );
  }

  return items;
}

async function buildSuperAdminNotifications() {
  const [{ count: pendingStudents }, { count: liveElections }, { count: disabledAdmins }] =
    await Promise.all([
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("elections")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "draft"]),
      supabase
        .from("admin_users")
        .select("id", { count: "exact", head: true })
        .eq("status", "disabled"),
    ]);

  return [
    toNotification({
      id: "admin-pending-students",
      title: `${pendingStudents || 0} student accounts pending`,
      body: "Review imported student records and setup progress.",
      href: "/super-admin/students",
      tone: pendingStudents ? "warning" : "default",
    }),
    toNotification({
      id: "admin-live-elections",
      title: `${liveElections || 0} elections in circulation`,
      body: "Track organization-level election timelines and result visibility settings.",
      href: "/super-admin/elections",
      tone: liveElections ? "success" : "default",
    }),
    toNotification({
      id: "admin-disabled-admins",
      title: `${disabledAdmins || 0} disabled staff accounts`,
      body: "Confirm whether board and admin accounts still need access.",
      href: "/super-admin/users-roles",
    }),
  ];
}

export async function fetchNotificationsForUser(user) {
  if (!user?.role) {
    return [];
  }

  let items = [];

  if (user.role === "student") {
    items = await buildStudentNotifications(user);
  } else if (user.role === "electoral_board") {
    items = await buildBoardNotifications(user);
  } else if (user.role === "super_admin") {
    items = await buildSuperAdminNotifications(user);
  }

  return items
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
    )
    .slice(0, 20);
}
