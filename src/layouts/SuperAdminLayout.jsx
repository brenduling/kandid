import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { getStoredUser, signOutAdminSession } from "../utils/auth";
import GlobalSearch from "../components/GlobalSearch";
import NotificationCenter from "../components/NotificationCenter";
import MobileNav from "../components/MobileNav";
import MobileHeader from "../components/MobileHeader";
import MobileMenu from "../components/MobileMenu";
import { getProfileRoute } from "../utils/profile";
import logo from "../assets/kandidlogo.png";
import TransitionWrapper from "../components/TransitionWrapper";
import { superAdminMenuGroups, superAdminPrimaryNav } from "../config/navigation";
import { usePrompt } from "../context/PromptContext";
import { logAuditEvent } from "../utils/auditLog";

function SuperAdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());
  const prompt = usePrompt();
  const homePath = "/super-admin/dashboard";
  const showBackButton = location.pathname !== homePath;
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(superAdminMenuGroups.map((group) => [group.label, true])),
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
        "You'll need to sign in again to access your Super Admin Portal.",
      type: "info",
      variant: "editorial",
      confirmText: "Logout",
      cancelText: "Stay signed in",
    });
    if (!ok) return;

    await logAuditEvent({
      action: "logout",
      entityType: "auth",
      entityLabel: "Super Admin Portal",
      status: "completed",
      user,
    });
    await signOutAdminSession();
    navigate("/admin", { replace: true });
  }

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(homePath);
  }

  return (
    <div className="super-admin-theme kandid-app-theme app-shell relative overflow-hidden">
      <div className="ambient-orb left-[-120px] top-16 h-96 w-96 bg-[rgba(17,128,106,0.16)]" />
      <div className="ambient-orb bottom-8 right-[-90px] h-80 w-80 bg-[rgba(25,162,140,0.14)]" />

      <div className="shell-layout">
        <aside className="glass-panel-dark shell-sidebar shell-sidebar-collapsible">
          <div className="sidebar-brand-block border-b border-white/10 pb-5">
            <div className="flex items-center justify-center gap-3 lg:justify-start">
              <button
                type="button"
                onClick={() => navigate(homePath)}
                className="kandid-sidebar-brand-button flex items-center gap-3"
                aria-label="Go to super admin home"
              >
                <img
                  src={logo}
                  alt="KANDID Logo"
                  className="h-12 w-12 object-contain"
                />

                <div className="sidebar-reveal min-w-0">
                  <p className="menu-brand-title">KANDID</p>
                  <p className="menu-brand-copy">SUPER ADMIN</p>
                </div>
              </button>
            </div>
          </div>

          <nav className="sidebar-nav-scroll">
            {superAdminMenuGroups.map((group, groupIndex) => {
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

                        return (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            aria-label={item.name}
                            title={item.name}
                            data-tooltip={item.name}
                            className={({ isActive }) =>
                              `fade-up nav-item ${isActive ? "nav-item-active" : ""}`
                            }
                            style={{
                              animationDelay: `${groupIndex * 110 + itemIndex * 28}ms`,
                            }}
                          >
                            <span className="nav-item-icon">
                              <Icon size={18} />
                            </span>
                            <span className="sidebar-reveal min-w-0">{item.name}</span>
                          </NavLink>
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

        <main className="workspace-main">
          <header className="shell-header kandid-header hidden lg:flex fade-up">
            <GlobalSearch
              user={user}
              className="shell-search lg:max-w-xl"
            />

            <div className="kandid-header-actions hidden w-full items-center justify-between gap-3 sm:w-auto sm:justify-end lg:flex">
              <NotificationCenter user={user} />

              <button
                onClick={() => navigate(getProfileRoute(user?.role))}
                className="shell-profile-chip"
              >
                {user?.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt="Admin profile"
                    className="shell-profile-avatar h-12 w-12 object-cover"
                  />
                ) : (
                  <div className="shell-profile-avatar shell-profile-monogram flex h-12 w-12 items-center justify-center text-sm font-black">
                    SA
                  </div>
                )}
                <div className="shell-profile-copy min-w-0 text-left">
                  <p className="truncate text-sm font-bold text-[#18212b]">
                    {user?.full_name || "Super Admin"}
                  </p>
                  <p className="surface-subcopy truncate text-xs">System Administrator</p>
                </div>
              </button>
            </div>
          </header>

          <section className="content-stack pb-24 pt-20 lg:pb-8 lg:pt-8">
            {showBackButton ? (
              <button
                type="button"
                onClick={handleBack}
                className="app-page-back-button"
              >
                <ArrowLeft size={15} />
                Back
              </button>
            ) : null}

            <TransitionWrapper>
              <Outlet />
            </TransitionWrapper>
          </section>
        </main>
      </div>

      <MobileHeader
        user={user}
        onMenuClick={() => setIsMobileMenuOpen(true)}
        homePath={homePath}
      />

      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        menuGroups={superAdminMenuGroups}
        user={user}
        onLogout={handleLogout}
        title="SUPER ADMIN"
      />

      <MobileNav
        primaryItems={superAdminPrimaryNav}
      />
    </div>
  );
}

export default SuperAdminLayout;
