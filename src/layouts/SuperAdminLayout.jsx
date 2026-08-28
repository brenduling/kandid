import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { clearStoredUser, getStoredUser } from "../utils/auth";
import NotificationCenter from "../components/NotificationCenter";
import MobileNav from "../components/MobileNav";
import { getProfileRoute } from "../utils/profile";
import logo from "../assets/kandidlogo.png";
import TransitionWrapper from "../components/TransitionWrapper";
import { superAdminMenuGroups } from "../config/navigation";
import { usePrompt } from "../context/PromptContext";

function SuperAdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const prompt = usePrompt();
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(superAdminMenuGroups.map((group) => [group.label, true])),
  );
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem("super-admin-sidebar-collapsed") === "true";
  });

  const toggleSidebar = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem("super-admin-sidebar-collapsed", String(nextState));
  };

  async function handleLogout() {
    const ok = await prompt.confirm({
      title: "Logout Confirmation",
      message: "Are you sure you want to sign out of the Super Admin Portal?",
      type: "warning",
      confirmText: "Logout",
    });
    if (!ok) return;

    clearStoredUser();
    navigate("/admin-login", { replace: true });
  }

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  return (
    <div className="super-admin-theme kandid-app-theme app-shell relative overflow-hidden">
      <div className="ambient-orb left-[-120px] top-16 h-96 w-96 bg-[rgba(17,128,106,0.16)]" />
      <div className="ambient-orb bottom-8 right-[-90px] h-80 w-80 bg-[rgba(25,162,140,0.14)]" />

      <div className="shell-layout">
        <aside className={`glass-panel-dark shell-sidebar ${isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
          <div className="sidebar-brand-block border-b border-white/10 pb-5">
            <div className="flex flex-col items-center gap-3 lg:flex-row lg:justify-between w-full">
              <div className="flex items-center gap-3">
                <img
                  src={logo}
                  alt="KANDID Logo"
                  className="h-12 w-12 object-contain"
                />

                <div className="sidebar-reveal min-w-0">
                  <p className="menu-brand-title">KANDID</p>
                  <p className="menu-brand-copy">Super Admin Portal</p>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
              >
                {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
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
          >
            <LogOut size={18} />
            <span className="sidebar-reveal">Logout</span>
          </button>
        </aside>

        <main className="workspace-main">
          <header className="glass-panel shell-header fade-up">
            <div className="glass-panel-strong shell-search lg:max-w-xl">
              <Search size={18} className="text-gray-400" />
              <input
                placeholder="Search users, organizations, elections, logs..."
              />
            </div>

            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <NotificationCenter user={user} />

              <button
                onClick={() => navigate(getProfileRoute(user?.role))}
                className="glass-panel-strong shell-profile-chip"
              >
                {user?.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt="Admin profile"
                    className="h-12 w-12 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-sm font-black text-[#11806a]">
                    SA
                  </div>
                )}
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-bold text-[#18212b]">
                    {user?.full_name || "Super Admin"}
                  </p>
                  <p className="surface-subcopy truncate text-xs">System Administrator</p>
                </div>
              </button>
            </div>
          </header>

          <section className="content-stack">
            <TransitionWrapper>
              <Outlet />
            </TransitionWrapper>
          </section>
        </main>
      </div>

      <MobileNav groups={superAdminMenuGroups} onLogout={handleLogout} />
    </div>
  );
}

export default SuperAdminLayout;
