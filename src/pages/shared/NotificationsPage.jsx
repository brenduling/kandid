import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KandidInlineLoader } from "../../components/KandidLoader";
import {
  fetchNotificationsForUser,
  getReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markStoredNotificationRead,
} from "../../utils/notifications";
import { getStoredUser } from "../../utils/auth";
import { formatRelativeTime } from "../../utils/time";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";

function getNotificationPresentation(item) {
  const href = item.href || "";
  const id = String(item.id || "");

  if (href.startsWith("/student/vote/")) return { context: "VOTING / ELECTION", action: "CAST MY VOTE" };
  if (href.startsWith("/student/results")) return { context: "RESULTS / ELECTION", action: "VIEW RESULTS" };
  if (href.startsWith("/student/elections/")) return { context: "CAMPAIGN / ELECTION", action: "VIEW CAMPAIGN" };
  if (href === "/student/receipt") return { context: "VOTING / RECEIPT", action: "VIEW RECEIPT" };
  if (href === "/student/profile") return { context: "ACCOUNT / ORGANIZATION", action: "REVIEW PROFILE" };
  if (href === "/board/voting-monitor") return { context: "VOTING / BOARD", action: "OPEN VOTING MONITOR" };
  if (href === "/board/elections") return { context: "CAMPAIGN / BOARD", action: "VIEW ELECTIONS" };
  if (href === "/board/dashboard") return { context: "BOARD / STATUS", action: "OPEN DASHBOARD" };
  if (href === "/super-admin/students") return { context: "ADMINISTRATION / STUDENTS", action: "REVIEW STUDENTS" };
  if (href === "/super-admin/elections") return { context: "ADMINISTRATION / ELECTIONS", action: "VIEW ELECTIONS" };
  if (href === "/super-admin/users-roles") return { context: "ADMINISTRATION / STAFF", action: "REVIEW STAFF" };
  if (id.startsWith("stored:")) return { context: "ACCOUNT / ORGANIZATION", action: null };
  return { context: "NOTIFICATION", action: null };
}

function NotificationsPage({ user }) {
  const navigate = useNavigate();
  const activeUser = useMemo(() => user || getStoredUser(), [user]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const isBoard = activeUser?.role === "electoral_board";
  const [readIds, setReadIds] = useState(() =>
    activeUser?.id ? getReadNotifications(activeUser) : [],
  );

  useEffect(() => {
    let active = true;
    if (!activeUser?.id) {
      Promise.resolve().then(() => {
        if (!active) return;
        setLoading(false);
        setLoadError("Your account could not be verified. Sign in again and retry.");
      });
      return () => {
        active = false;
      };
    }

    async function loadNotifications() {
      setLoading(true);
      setLoadError("");
      try {
        const items = await fetchNotificationsForUser(activeUser);
        if (!active) return;
        setNotifications(items);
        setReadIds(getReadNotifications(activeUser));
      } catch {
        if (!active) return;
        setLoadError("Notifications could not be loaded. Check your connection and try again.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadNotifications();

    return () => {
      active = false;
    };
  }, [activeUser, retryCount]);

  const unreadCount = useMemo(() => {
    const readSet = new Set(readIds.map(String));
    return notifications.filter((item) => !item.isRead && !readSet.has(String(item.id))).length;
  }, [notifications, readIds]);
  const roleLabel = activeUser?.role === "student"
    ? "Student"
    : activeUser?.role === "electoral_board"
      ? "Electoral Board"
      : "Super Admin";
  const emptyDescription = isBoard
    ? "Election activity and important Board notices will appear here."
    : activeUser?.role === "super_admin"
      ? "Important election and system updates will appear here."
      : "Election activity and important account notices will appear here.";

  async function handleMarkAllRead() {
    if (!activeUser || markingAllRead) return;
    setMarkingAllRead(true);
    setActionError("");
    try {
      const results = await Promise.all(
        notifications
          .filter((item) => item.storedId && !item.isRead)
          .map((item) => markStoredNotificationRead(activeUser, item.id)),
      );
      if (results.some(result => result?.error)) throw new Error("Notification read state could not be saved.");
      markAllNotificationsRead(activeUser, notifications);
      setReadIds(notifications.map((item) => String(item.id)));
      window.dispatchEvent(new Event("kandid-notifications-read"));
    } catch {
      setActionError("Notification read state could not be saved. Please try again.");
    } finally {
      setMarkingAllRead(false);
    }
  }

  async function handleOpenNotification(item) {
    if (!activeUser) return;
    setActionError("");
    try {
      if (item.storedId && !item.isRead) {
        const result = await markStoredNotificationRead(activeUser, item.id);
        if (result.error) throw result.error;
      }
    } catch {
      setActionError("Notification read state could not be saved. Please try again.");
      return;
    }
    markNotificationRead(activeUser, item.id);
    setReadIds((current) => [...new Set([...current.map(String), String(item.id)])]);
    window.dispatchEvent(new Event("kandid-notifications-read"));
    if (item.href) navigate(item.href);
  }

  return (
    <div className="notifications-page">
      {actionError ? <p role="alert">{actionError}</p> : null}
      {activeUser?.role === "super_admin" ? (
        <SuperAdminPageHeader
          section="System record"
          title="Notifications"
          description="Review important election and system updates."
          actions={(
            <div className="notifications-page-actions">
              {loading ? <span className="notifications-unread-count" aria-live="polite">Loading</span> : unreadCount > 0 ? (
                <>
                  <span className="notifications-unread-count" aria-live="polite">{unreadCount} unread</span>
                  <button type="button" onClick={handleMarkAllRead} className="notifications-mark-all" disabled={markingAllRead}>
                    {markingAllRead ? "Marking read…" : "Mark all read"}
                  </button>
                </>
              ) : null}
            </div>
          )}
        />
      ) : (
      <header className="notifications-page-header">
        <div className="notifications-page-context">
          <span>{roleLabel}</span>
          <span className="notifications-page-context-rule" aria-hidden="true" />
        </div>
        <div className="notifications-page-title-row">
          <h1 className="page-title">Notifications</h1>
          <div className="notifications-page-actions">
            {loading ? (
              <span className="notifications-unread-count" aria-live="polite">Loading</span>
            ) : unreadCount > 0 ? (
              <>
                <span className="notifications-unread-count" aria-live="polite">{unreadCount} unread</span>
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="notifications-mark-all"
                  disabled={markingAllRead}
                >
                  {markingAllRead ? "Marking read…" : "Mark all read"}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <p className="notifications-page-description">What needs your attention, in one place.</p>
      </header>
      )}

      <section className={`notifications-list-panel${isBoard ? " is-board-notifications" : ""}`} aria-label="Notification activity">
        {loading ? (
          isBoard ? (
            <div className="board-notifications-skeleton" role="status" aria-label="Loading notifications" aria-busy="true">
              <span className="sr-only">Loading notifications</span>
              {[0, 1, 2, 3].map((index) => (
                <div className="board-notification-skeleton-row" key={index} aria-hidden="true">
                  <span className="board-notification-skeleton-marker" />
                  <span className="board-notification-skeleton-copy">
                    <span className="board-notification-skeleton-line is-title" />
                    <span className="board-notification-skeleton-line is-body" />
                    <span className="board-notification-skeleton-line is-date" />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notifications-empty-state">
              <KandidInlineLoader message="Loading notifications..." />
            </div>
          )
        ) : loadError ? (
          <div className="notifications-empty-state is-error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="secondary-btn" onClick={() => setRetryCount((count) => count + 1)}>
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="notifications-empty-state">
            <h2>Nothing needs your attention.</h2>
            <p>{emptyDescription}</p>
          </div>
        ) : (
          <div className="notifications-list">
            {notifications.map((item) => {
              const unread = !item.isRead && !readIds.map(String).includes(String(item.id));
              const presentation = getNotificationPresentation(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenNotification(item)}
                  className={`notification-page-row tone-${item.tone || "default"} ${unread ? "is-unread" : "is-read"}`}
                >
                  <span className="notification-page-row-copy">
                    <span className="notification-page-row-meta">
                      <span className="notification-page-context">{presentation.context}</span>
                      <time dateTime={item.timestamp || undefined}>{formatRelativeTime(item.timestamp)}</time>
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                    {presentation.action ? (
                      <span className="notification-page-action">{presentation.action}<span aria-hidden="true"> →</span></span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default NotificationsPage;
