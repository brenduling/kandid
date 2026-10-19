import { supabase } from "../lib/supabaseClient";
import { canStudentViewResults, getElectionPhase } from "./elections";
import { isMissingResultReleaseColumn } from "./results";
import { getStudentDashboardMemberships } from "./organizationAccess";
import { callVoteAccess } from "./voteAccess";
import { listAdminUsers } from "./adminUsers";

function toNotification({
  id,
  title,
  body,
  href,
  timestamp,
  tone = "default",
  isRead = false,
  storedId = null,
}) {
  return {
    id,
    title,
    body,
    href,
    tone,
    isRead,
    storedId,
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

async function fetchPersistentStudentNotifications() {
  const { data, error } = await supabase.functions.invoke("student-notifications", {
    body: {
      action: "list",
      limit: 20,
    },
  });

  if (error) {
    throw new Error("Notification service unavailable. Please try again.");
  }
  if (!Array.isArray(data?.data?.notifications)) throw new Error("Notification service unavailable. Please try again.");
  const rows = data.data.notifications;
  if (rows.length > 20 || new Set(rows.map(row => row?.id)).size !== rows.length || rows.some(row =>
    !Number.isSafeInteger(row?.id) || row.id <= 0 || typeof row.title !== "string" || typeof row.message !== "string" ||
    typeof row.is_read !== "boolean" || !Number.isFinite(Date.parse(row.created_at)))) {
    throw new Error("Notification service unavailable. Please try again.");
  }
  return data.data.notifications.map((notification) =>
    toNotification({
      id: `stored:${notification.id}`,
      storedId: notification.id,
      title: notification.title,
      body: notification.message,
      href: typeof notification.metadata?.href === "string" && notification.metadata.href.startsWith("/student/") && !notification.metadata.href.includes("\\")
        ? notification.metadata.href : "/student/notifications",
      timestamp: notification.created_at,
      tone: notification.type === "organization_restored" ? "success" : "warning",
      isRead: Boolean(notification.is_read),
    }),
  );
}

export async function markStoredNotificationRead(_user, notificationId) {
  const storedId = String(notificationId || "").startsWith("stored:")
    ? String(notificationId).slice("stored:".length)
    : notificationId;
  const numericId = Number(storedId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return { error: new Error("Notification read state could not be saved.") };

  const { data, error } = await supabase.functions.invoke("student-notifications", {
    body: {
      action: "mark_read",
      notification_id: numericId,
    },
  });

  return { error: error || (data?.data?.notification_id !== numericId ? new Error("Notification read state could not be saved.") : null) };
}

export function markAllNotificationsRead(user, notifications) {
  localStorage.setItem(
    getReadStorageKey(user),
    JSON.stringify(notifications.map((item) => item.id)),
  );
}

async function buildStudentNotifications(user) {
  const [current, persistentNotifications] = await Promise.all([
    getStudentDashboardMemberships(user),
    fetchPersistentStudentNotifications(),
  ]);
  const organizationIds = current.memberships.map(row => Number(row.organization_id));

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

  let [{ data: elections, error: electionsError }, voteStatus] = await Promise.all([
    organizationIds.length
      ? fetchElections()
      : Promise.resolve({ data: [], error: null }),
    callVoteAccess("student_voted_elections"),
  ]);

  if (isMissingResultReleaseColumn(electionsError)) {
    const fallback = await fetchElections(false);
    elections = (fallback.data || []).map((election) => ({
      ...election,
      results_released_at: null,
    }));
    electionsError = fallback.error;
  }
  if (electionsError || voteStatus.error) throw new Error("Notification service unavailable. Please try again.");

  const votedElectionIds = new Set((voteStatus.data?.election_ids || []).map(Number));
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

    if (phase === "voting" && !votedElectionIds.has(Number(election.id))) {
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

  if (!voteStatus.error && votedElectionIds.size > 0) {
    items.push(
      toNotification({
        id: "student-receipt",
        title: "Your vote receipt is ready",
        body: "You can review your submitted ballot records and verification hashes anytime.",
        href: "/student/receipt",
        timestamp: voteStatus.data?.latest_vote_at?.[String([...votedElectionIds][0])] || null,
      }),
    );
  }

  return [...persistentNotifications, ...items];
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

  return items;
}

async function buildSuperAdminNotifications() {
  const disabledAdminsRequest = listAdminUsers().then(({ data, error }) => ({
    count: error ? 0 : (data || []).filter((admin) => admin.status === "disabled").length,
  }));

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
      disabledAdminsRequest,
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

async function loadNotificationsForUser(user) {
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

  const nextItems = items
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
    )
    .slice(0, 20);

  if (user.role === "student") {
    const readIds = new Set(getReadNotifications(user).map(String));
    nextItems.forEach((item) => {
      if (item.isRead) readIds.add(String(item.id));
    });
    localStorage.setItem(getReadStorageKey(user), JSON.stringify([...readIds]));
  }

  return nextItems;
}

// The desktop/mobile bell and page may mount together. Share only concurrent
// reads for the same account; do not cache failures or another user's results.
const notificationRequests = new Map();
export function fetchNotificationsForUser(user) {
  if (!user?.id || !user?.role) return Promise.resolve([]);
  const key = JSON.stringify([user.id, user.role, user.organization_id, user.program]);
  if (!notificationRequests.has(key)) {
    const request = loadNotificationsForUser(user).finally(() => {
      if (notificationRequests.get(key) === request) notificationRequests.delete(key);
    });
    notificationRequests.set(key, request);
  }
  return notificationRequests.get(key);
}
