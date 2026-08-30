import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { KandidInlineLoader } from "./KandidLoader";
import {
  fetchNotificationsForUser,
  getReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../utils/notifications";
import { formatLocalDateTime } from "../utils/time";

function NotificationCenter({ user }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() =>
    user?.id ? getReadNotifications(user) : [],
  );
  const [panelPosition, setPanelPosition] = useState({ top: 72, right: 16, width: 384 });
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
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
    if (!open) return;

    function updatePosition() {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;

      const mobile = window.innerWidth < 640;
      const width = mobile ? Math.min(window.innerWidth - 24, 360) : Math.min(window.innerWidth - 32, 384);
      const top = buttonRect.bottom + 12;
      const right = mobile ? 12 : Math.max(16, window.innerWidth - buttonRect.right);

      setPanelPosition({ top, right, width });
    }

    function handlePointerDown(event) {
      const target = event.target;

      if (
        wrapperRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const unreadNotifications = useMemo(() => {
    const readSet = new Set(readIds.map(String));
    return notifications.filter((item) => !readSet.has(String(item.id)));
  }, [notifications, readIds]);

  const unreadCount = unreadNotifications.length;
  const showUnreadBadge = unreadCount > 0 && !loading;

  function handleOpen() {
    setOpen((current) => !current);
  }

  function handleNavigate(item) {
    if (!user) return;
    markNotificationRead(user, item.id);
    setReadIds((current) => [...new Set([...current.map(String), String(item.id)])]);
    setOpen(false);
    if (item.href) {
      navigate(item.href);
    }
  }

  function handleMarkAllRead() {
    if (!user) return;
    markAllNotificationsRead(user, notifications);
    setReadIds(notifications.map((item) => String(item.id)));
  }

  const panel = open
    ? createPortal(
        <>
          <div className="notification-backdrop fixed inset-0 z-40 bg-black/10 sm:bg-transparent" />
          <div
            ref={panelRef}
            className="notification-panel glass-panel-strong fixed z-50 rounded-[28px] p-4 shadow-[0_24px_60px_rgba(7,17,16,0.2)]"
            style={{
              top: panelPosition.top,
              right: panelPosition.right,
              width: panelPosition.width,
              maxWidth: "calc(100vw - 24px)",
              maxHeight: "min(70vh, 40rem)",
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-black/5 pb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                  Notifications
                </p>
                <p className="surface-subcopy mt-1 text-sm">
                  {unreadCount > 0
                    ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}`
                    : "Everything is up to date"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-xs font-bold text-[#1d262f]"
                >
                  <CheckCheck size={14} />
                  Mark all
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70 text-[#1d262f]"
                  aria-label="Close notifications"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-[calc(min(70vh,40rem)-5rem)] space-y-3 overflow-y-auto pr-1">
              {loading ? (
                <div className="surface-subcopy flex items-center gap-2 rounded-2xl bg-white/50 px-4 py-4 text-sm">
                  <KandidInlineLoader message="Loading notifications..." />
                </div>
              ) : notifications.length === 0 ? (
                <div className="surface-subcopy rounded-2xl bg-white/50 px-4 py-4 text-sm">
                  No notifications yet.
                </div>
              ) : (
                notifications.map((item) => {
                  const unread = !readIds.includes(item.id);

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item)}
                      className={`w-full rounded-[24px] border p-4 text-left ${
                        unread
                          ? "border-[rgba(239,78,35,0.18)] bg-[rgba(239,78,35,0.08)]"
                          : "border-black/5 bg-white/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-[#18212b]">{item.title}</p>
                          <p className="surface-copy mt-2 text-sm leading-6">
                            {item.body}
                          </p>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#55726b]">
                            {formatLocalDateTime(item.timestamp, "Just now")}
                          </p>
                        </div>
                        <ChevronRight size={16} className="mt-1 text-gray-400" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          ref={buttonRef}
          onClick={handleOpen}
          className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/60 text-[#24313d] shadow-sm"
          aria-label="Open notifications"
          aria-expanded={open}
        >
          <Bell size={18} />
          {showUnreadBadge ? (
            <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ef4e23] px-1 text-[10px] font-black text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </div>
      {panel}
    </>
  );
}

export default NotificationCenter;
