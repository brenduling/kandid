import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchNotificationsForUser,
  getReadNotifications,
} from "../utils/notifications";
import {
  NOTIFICATION_STALE_AFTER_MS,
  shouldRefreshNotifications,
} from "../utils/notificationRefresh";

function getNotificationRoute(role) {
  if (role === "super_admin") return "/super-admin/notifications";
  if (role === "electoral_board") return "/board/notifications";
  return "/student/notifications";
}

function NotificationCenter({ user, placement = "any" }) {
  const [notifications, setNotifications] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [readIds, setReadIds] = useState(() =>
    user?.id ? getReadNotifications(user) : [],
  );
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const loadCurrentRef = useRef(null);
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
  const location = useLocation();
  const scopeKey = JSON.stringify([
    userId || "",
    userRole || "",
    userOrganizationId || "",
    userProgram || "",
  ]);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const placementActive = placement === "any"
    || (placement === "desktop" && isDesktopViewport)
    || (placement === "mobile" && !isDesktopViewport);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktopViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!notificationUser?.id || !placementActive) return undefined;

    let active = true;
    let inFlight = false;
    let lastAttemptAt = 0;
    let refreshTimer = null;

    function clearRefreshTimer() {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }

    function scheduleForegroundRefresh() {
      clearRefreshTimer();
      if (!active || document.visibilityState === "hidden") return;
      refreshTimer = window.setTimeout(async () => {
        refreshTimer = null;
        await loadNotifications();
      }, NOTIFICATION_STALE_AFTER_MS);
    }

    async function loadNotifications({ force = false } = {}) {
      if (
        document.visibilityState === "hidden" ||
        inFlight ||
        (!force && !shouldRefreshNotifications(lastAttemptAt)) ||
        (force && lastAttemptAt && Date.now() - lastAttemptAt < 10000)
      ) return;
      inFlight = true;
      lastAttemptAt = Date.now();

      try {
        const items = await fetchNotificationsForUser(notificationUser);

        if (!active) return;

        setNotifications(items);
        setReadIds(getReadNotifications(notificationUser));
        setLoadedScopeKey(scopeKey);
        setLoadError(false);
      } catch (error) {
        if (!active) return;
        setLoadError(true);
        setLoadedScopeKey("");
        console.warn("Notifications could not be refreshed:", error?.message || error);
      } finally {
        inFlight = false;
        if (active) {
          scheduleForegroundRefresh();
        }
      }
    }

    const loadIfStale = () => loadNotifications();
    const loadAfterRelevantChange = () => loadNotifications({ force: true });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearRefreshTimer();
        return;
      }
      loadIfStale();
      scheduleForegroundRefresh();
    };

    loadCurrentRef.current = loadIfStale;
    loadNotifications({ force: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", loadIfStale);
    window.addEventListener("online", loadIfStale);
    window.addEventListener("kandid-audit-updated", loadAfterRelevantChange);
    window.addEventListener("kandid-user-updated", loadAfterRelevantChange);

    return () => {
      active = false;
      clearRefreshTimer();
      if (loadCurrentRef.current === loadIfStale) loadCurrentRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", loadIfStale);
      window.removeEventListener("online", loadIfStale);
      window.removeEventListener("kandid-audit-updated", loadAfterRelevantChange);
      window.removeEventListener("kandid-user-updated", loadAfterRelevantChange);
    };
  }, [notificationUser, placementActive, scopeKey]);

  useEffect(() => {
    loadCurrentRef.current?.();
  }, [location.key, scopeKey]);

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

  const unreadCount = loadedScopeKey === scopeKey ? unreadNotifications.length : 0;
  const showUnreadBadge = unreadCount > 0;

  function handleOpen() {
    navigate(getNotificationRoute(user?.role));
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="kandid-notification-action relative flex h-12 w-12 items-center justify-center text-[#24313d]"
        aria-label={loadError ? "Notifications unavailable. Open notifications page to retry" : "Open notifications page"}
        title={loadError ? "Notifications unavailable" : "Notifications"}
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
