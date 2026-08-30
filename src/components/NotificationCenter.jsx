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
  const navigate = useNavigate();

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;

    async function loadNotifications() {
      setLoading((current) => current || notificationsRef.current.length === 0);
      const items = await fetchNotificationsForUser(user);

      if (!active) return;

      setNotifications(items);
      setReadIds(getReadNotifications(user));
      setLoading(false);
    }

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id, user?.role, user?.organization_id]);

  useEffect(() => {
    if (!user?.id) return undefined;

    function handleReadStateChanged() {
      setReadIds(getReadNotifications(user));
    }

    window.addEventListener("kandid-notifications-read", handleReadStateChanged);
    window.addEventListener("storage", handleReadStateChanged);

    return () => {
      window.removeEventListener("kandid-notifications-read", handleReadStateChanged);
      window.removeEventListener("storage", handleReadStateChanged);
    };
  }, [user]);

  const unreadNotifications = useMemo(() => {
    const readSet = new Set(readIds.map(String));
    return notifications.filter((item) => !readSet.has(String(item.id)));
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
        className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/60 text-[#24313d] shadow-sm"
        aria-label="Open notifications page"
      >
        <Bell size={18} />
        {showUnreadBadge ? (
          <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ef4e23] px-1 text-[10px] font-black text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export default NotificationCenter;
