import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
} from "lucide-react";
import { getStoredUser, signOutAdminSession } from "../utils/auth";
import GlobalSearch from "../components/GlobalSearch";
import MobileNav from "../components/MobileNav";
import MobileHeader from "../components/MobileHeader";
import MobileMenu from "../components/MobileMenu";
import NotificationCenter from "../components/NotificationCenter";
import { getProfileRoute } from "../utils/profile";
import { boardMenuGroups, boardPrimaryNav } from "../config/navigation";
import logo from "../assets/kandidlogo.png";
import TransitionWrapper from "../components/TransitionWrapper";
import { usePrompt } from "../context/PromptContext";
import { logAuditEvent } from "../utils/auditLog";
import {
  LOCAL_PRODUCTION_READONLY_BOARD_PATHS,
  READ_ONLY_DASHBOARD_MODE,
} from "../utils/localProductionReadOnly";

const localProductionReadonly = import.meta.env.MODE === READ_ONLY_DASHBOARD_MODE;

function BoardLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());
  const prompt = usePrompt();
  const homePath = "/board/dashboard";
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(boardMenuGroups.map((group) => [group.label, true])),
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const visibleBoardMenuGroups = localProductionReadonly
    ? boardMenuGroups
      .map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          readonlyUnavailable: !LOCAL_PRODUCTION_READONLY_BOARD_PATHS.has(item.path),
        })),
      }))
    : boardMenuGroups;
  const visibleBoardPrimaryNav = localProductionReadonly
    ? boardPrimaryNav.map((item) => ({
        ...item,
        readonlyUnavailable: !LOCAL_PRODUCTION_READONLY_BOARD_PATHS.has(item.path),
      }))
    : boardPrimaryNav;

  useEffect(() => {
    if (!user || user.role !== "electoral_board") {
      navigate("/eb-login");
    }
  }, [navigate, user]);

  useEffect(() => {
    function handleUserUpdated(event) {
      setUser(event.detail || getStoredUser());
    }

    window.addEventListener("kandid-user-updated", handleUserUpdated);
    window.addEventListener("storage", handleUserUpdated);

    return () => {
      window.removeEventListener("kandid-user-updated", handleUserUpdated);
      window.removeEventListener("storage", handleUserUpdated);
    };
  }, []);

  async function handleLogout() {
    const ok = await prompt.confirm({
      eyebrow: "Signing out",
      title: "Leaving Kandid?",
      message:
        "You'll need to sign in again to access your Electoral Board Portal.",
      type: "info",
      variant: "editorial",
      confirmText: "Logout",
      cancelText: "Stay signed in",
    });
    if (!ok) return;

    if (!localProductionReadonly) {
      await logAuditEvent({
        action: "logout",
        entityType: "auth",
        entityLabel: "Electoral Board Portal",
        organizationId: user?.organization_id,
        organizationName: user?.organizations?.name,
        status: "completed",
        user,
      });
    }
    await signOutAdminSession();
    navigate(localProductionReadonly ? "/eb-login" : "/board-portal", { replace: true });
  }

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  return (
    <div className="board-theme kandid-app-theme app-shell relative overflow-hidden">
      <div className="shell-layout">
        <aside className="glass-panel-dark shell-sidebar shell-sidebar-collapsible">
          <div className="sidebar-brand-block border-b border-white/10 pb-5">
            <button
              type="button"
              onClick={() => navigate(homePath)}
              className="kandid-sidebar-brand-button flex items-center justify-center gap-3 lg:justify-start"
              aria-label="Go to electoral board home"
            >
              <img
                src={logo}
                alt="KANDID Logo"
                className="h-12 w-12 object-contain"
              />

              <div className="sidebar-reveal min-w-0">
                <p className="menu-brand-title">KANDID</p>
                <p className="menu-brand-copy">ELECTORAL BOARD</p>
              </div>
            </button>
            <div className="sidebar-brand-copy">
              <p className="mt-4 menu-brand-copy">Election workspace</p>
            </div>
          </div>

          <nav className="sidebar-nav-scroll">
            {visibleBoardMenuGroups.map((group, groupIndex) => {
              const isGroupOpen =
                openGroups[group.label] ??
                group.items.some((item) => location.pathname.startsWith(item.path));

              return (
                <div
                  key={group.label}
                  className={`sidebar-group ${groupIndex > 0 ? "sidebar-group-separator" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    className="nav-section-trigger"
                  >
                    <span className="sidebar-reveal">{group.label}</span>
                    <ChevronDown
                      size={15}
                      className={`nav-section-trigger-chevron transition-transform ${isGroupOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  <div className="nav-section-body" data-open={isGroupOpen}>
                    <div className="nav-section-inner mt-3 space-y-2">
                      {group.items.map((item, itemIndex) => {
                        const Icon = item.icon;
                        const itemClass = `fade-up nav-item${item.readonlyUnavailable ? " nav-item-disabled opacity-50" : ""}`;

                        return (
                          item.readonlyUnavailable ? (
                            <button
                              key={item.path}
                              type="button"
                              disabled
                              aria-disabled="true"
                              aria-label={`${item.name}, unavailable in read-only production inspection`}
                              title="Unavailable during read-only production inspection"
                              data-tooltip={`${item.name} · unavailable in read-only mode`}
                              className={itemClass}
                              style={{ animationDelay: `${groupIndex * 110 + itemIndex * 28}ms` }}
                            >
                              <span className="nav-item-icon"><Icon size={18} /></span>
                              <span className="sidebar-reveal min-w-0">{item.name} · unavailable</span>
                            </button>
                          ) : (
                            <NavLink
                              key={item.path}
                              to={item.path}
                              aria-label={item.name}
                              title={item.name}
                              data-tooltip={item.name}
                              className={({ isActive }) => `${itemClass} ${isActive ? "nav-item-active" : ""}`}
                              style={{ animationDelay: `${groupIndex * 110 + itemIndex * 28}ms` }}
                            >
                              <span className="nav-item-icon"><Icon size={18} /></span>
                              <span className="sidebar-reveal min-w-0">{item.name}</span>
                            </NavLink>
                          )
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>

          <button
            onClick={handleLogout}
            className="sidebar-logout-btn"
            aria-label="Logout"
            title="Logout"
            data-tooltip="Logout"
          >
            <span className="nav-item-icon">
              <LogOut size={18} />
            </span>
            <span className="sidebar-reveal">Logout</span>
          </button>
        </aside>

        {/* Main content area */}
        <main className="workspace-main">
          {/* Header area */}
          <header className="shell-header kandid-header hidden lg:flex fade-up">
            {localProductionReadonly ? (
              <p className="rounded-full border border-amber-700/20 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
                Local read-only test connected to production data
              </p>
            ) : (
              <GlobalSearch
                user={user}
                className="shell-search lg:max-w-xl"
                placeholder="Search elections, candidates, reports..."
              />
            )}

            <div className="kandid-header-actions hidden w-full items-center justify-between gap-3 sm:w-auto sm:justify-end lg:flex">
              {!localProductionReadonly && <NotificationCenter user={user} placement="desktop" />}

              {localProductionReadonly ? (
                <div className="shell-profile-chip" aria-label="Electoral Board account">
                  {user?.photo_url ? (
                    <img src={user.photo_url} alt="Board profile" className="shell-profile-avatar h-12 w-12 object-cover" />
                  ) : (
                    <div className="shell-profile-avatar shell-profile-monogram flex h-12 w-12 items-center justify-center text-sm font-black">EB</div>
                  )}
                  <div className="shell-profile-copy min-w-0 text-left">
                    <p className="truncate text-sm font-bold text-[#18212b]">{user?.full_name || "Electoral Board"}</p>
                    <p className="surface-subcopy truncate text-xs">{user?.organizations?.name || "Assigned Organization"}</p>
                  </div>
                </div>
              ) : <button
                onClick={() => navigate(getProfileRoute(user?.role))}
                className="shell-profile-chip"
              >
                {user?.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt="Board profile"
                    className="shell-profile-avatar h-12 w-12 object-cover"
                  />
                ) : (
                  <div className="shell-profile-avatar shell-profile-monogram flex h-12 w-12 items-center justify-center text-sm font-black">
                    EB
                  </div>
                )}
                <div className="shell-profile-copy min-w-0 text-left">
                  <p className="truncate text-sm font-bold text-[#18212b]">
                    {user?.full_name || "Electoral Board"}
                  </p>
                  <p className="surface-subcopy truncate text-xs">
                    {user?.organizations?.name || "Assigned Organization"}
                  </p>
                </div>
              </button>}
            </div>
          </header>

          <section className="content-stack pb-24 pt-20 lg:pb-8 lg:pt-8">
            {localProductionReadonly && (
              <div className="mb-5 rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="note">
                Read-only Electoral Board test connected to production data. Writes are blocked in this local test mode; database RLS and server authorization remain authoritative.
              </div>
            )}
            <TransitionWrapper>
              <Outlet />
            </TransitionWrapper>
          </section>
        </main>
      </div>

      <MobileHeader
        user={localProductionReadonly ? null : user}
        onMenuClick={() => setIsMobileMenuOpen(true)}
        homePath={homePath}
      />

      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        menuGroups={visibleBoardMenuGroups}
        user={user}
        onLogout={handleLogout}
        title="ELECTORAL BOARD"
      />

      <MobileNav
        primaryItems={visibleBoardPrimaryNav}
      />
    </div>
  );
}

export default BoardLayout;
