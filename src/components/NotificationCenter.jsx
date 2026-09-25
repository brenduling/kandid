import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  fetchNotificationsForUser,
  getReadNotifications,
} from "../utils/notifications";

function getNotificationRoute(role) {
  if (role === "super_admin") return "/super-admin/notifications";
  if (role === "electoral_board") return "/board/notifications";
  return "/student/notifications";
}

function NotificationCenter({ user }) {
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() =>
    user?.id ? getReadNotifications(user) : [],
  );
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const notificationsRef = useRef([]);
  const loadingRef = useRef(false);
  const userId = user?.id;
  const userRole = user?.role;
  const userOrganizationId = user?.organization_id;
  const userProgram = user?.program;
  const notificationUser = useMemo(
    () =>
      userId
        ? {
            id: userId,
            role: userRole,
            organization_id: userOrganizationId,
            program: userProgram,
          }
        : null,
    [userId, userRole, userOrganizationId, userProgram],
  );
  const navigate = useNavigate();

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    if (!notificationUser?.id) return;

    let active = true;

    async function loadNotifications() {
      if (document.visibilityState === "hidden" || loadingRef.current) return;
      loadingRef.current = true;
      setLoading((current) => current || notificationsRef.current.length === 0);

      try {
        const items = await fetchNotificationsForUser(notificationUser);

        if (!active) return;

        setNotifications(items);
        setReadIds(getReadNotifications(notificationUser));
      } finally {
        loadingRef.current = false;
        if (active) setLoading(false);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadNotifications();
      }
    }

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      loadingRef.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [notificationUser]);

  useEffect(() => {
    if (!notificationUser?.id) return undefined;

    function handleReadStateChanged() {
      setReadIds(getReadNotifications(notificationUser));
    }

    window.addEventListener("kandid-notifications-read", handleReadStateChanged);
    window.addEventListener("storage", handleReadStateChanged);

    return () => {
      window.removeEventListener("kandid-notifications-read", handleReadStateChanged);
      window.removeEventListener("storage", handleReadStateChanged);
    };
  }, [notificationUser]);

  const unreadNotifications = useMemo(() => {
    const readSet = new Set(readIds.map(String));
    return notifications.filter((item) => !item.isRead && !readSet.has(String(item.id)));
  }, [notifications, readIds]);

  const unreadCount = unreadNotifications.length;
  const showUnreadBadge = unreadCount > 0 && !loading;

  function handleOpen() {
    navigate(getNotificationRoute(user?.role));
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="kandid-notification-action relative flex h-12 w-12 items-center justify-center text-[#24313d]"
        aria-label="Open notifications page"
      >
        <Bell size={18} />
        {showUnreadBadge ? (
          <span className="kandid-notification-count absolute right-1 top-0 flex min-w-4 items-center justify-center px-0.5 text-[10px] font-black">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export default NotificationCenter;
