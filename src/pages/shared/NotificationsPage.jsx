import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { KandidInlineLoader } from "../../components/KandidLoader";
import {
  fetchNotificationsForUser,
  getReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../utils/notifications";
import { getStoredUser } from "../../utils/auth";
import { formatLocalDateTime } from "../../utils/time";

function NotificationsPage({ user }) {
  const navigate = useNavigate();
  const activeUser = useMemo(() => user || getStoredUser(), [user]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() =>
    activeUser?.id ? getReadNotifications(activeUser) : [],
  );

  useEffect(() => {
    if (!activeUser?.id) return undefined;

    let active = true;

    async function loadNotifications() {
      setLoading(true);
      const items = await fetchNotificationsForUser(activeUser);

      if (!active) return;

      setNotifications(items);
      setReadIds(getReadNotifications(activeUser));
      setLoading(false);
    }

    loadNotifications();

    return () => {
      active = false;
    };
  }, [activeUser?.id, activeUser?.role, activeUser?.organization_id]);

  const unreadCount = useMemo(() => {
    const readSet = new Set(readIds.map(String));
    return notifications.filter((item) => !readSet.has(String(item.id))).length;
  }, [notifications, readIds]);

  function handleMarkAllRead() {
    if (!activeUser) return;
    markAllNotificationsRead(activeUser, notifications);
    setReadIds(notifications.map((item) => String(item.id)));
    window.dispatchEvent(new Event("kandid-notifications-read"));
  }

  function handleOpenNotification(item) {
    if (!activeUser) return;
    markNotificationRead(activeUser, item.id);
    setReadIds((current) => [...new Set([...current.map(String), String(item.id)])]);
    window.dispatchEvent(new Event("kandid-notifications-read"));
    if (item.href) navigate(item.href);
  }

  return (
    <div className="notifications-page">
      <section className="page-hero">
        <div className="notifications-page-actions">
          <span className="notifications-count-pill">
            {unreadCount} unread
          </span>
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="btn-secondary"
            disabled={loading || notifications.length === 0}
          >
            <CheckCheck size={16} />
            Mark all read
          </button>
        </div>
      </section>

      <section className="notifications-list-panel">
        {loading ? (
          <div className="notifications-empty-state">
            <KandidInlineLoader message="Loading notifications..." />
          </div>
        ) : notifications.length === 0 ? (
          <div className="notifications-empty-state">
            <Bell size={22} />
            <p>No notifications yet.</p>
          </div>
        ) : (
          <div className="notifications-list">
            {notifications.map((item) => {
              const unread = !readIds.map(String).includes(String(item.id));

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenNotification(item)}
                  className={`notification-page-row ${unread ? "is-unread" : ""}`}
                >
                  <span className="notification-page-row-icon">
                    <Bell size={17} />
                  </span>
                  <span className="notification-page-row-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                    <em>{formatLocalDateTime(item.timestamp, "Just now")}</em>
                  </span>
                  <ChevronRight size={18} />
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
