import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Search,
} from "lucide-react";
import { clearStoredUser, getStoredUser } from "../utils/auth";
import NotificationCenter from "../components/NotificationCenter";
import MobileNav from "../components/MobileNav";
import { getProfileRoute } from "../utils/profile";
import { boardMenuGroups, flattenMenuGroups } from "../config/navigation";
import logo from "../assets/kandidlogo.png";

const mobileMenuItems = flattenMenuGroups(boardMenuGroups);

function BoardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(boardMenuGroups.map((group) => [group.label, true])),
  );

  useEffect(() => {
    if (!user || user.role !== "electoral_board") {
      navigate("/eb-login");
    }
  }, [navigate, user]);

  function handleLogout() {
    if (!window.confirm("Are you sure you want to logout?")) return;

    clearStoredUser();
    navigate("/eb-login", { replace: true });
  }

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  return (
    <div className="app-shell relative overflow-hidden">  {/*sidebar wrapper*/}
      <div className="ambient-orb left-[-100px] top-32 h-80 w-80 bg-[rgba(25,162,140,0.16)]" /> {/*questionnable?*/}
      <div className="ambient-orb bottom-12 right-[-80px] h-72 w-72 bg-[rgba(17,128,106,0.12)]" />  {/*questionnable?*/}

      <div className="shell-layout">
        <aside className="glass-panel-dark shell-sidebar shell-sidebar-collapsible"> {/*allow collapsing of sidebar*/}
          <div className="sidebar-brand-block border-b border-white/10 pb-5">  {/*displays at the top of the sidebar means fixed*/}
            <div className="flex items-center justify-center gap-3 lg:justify-start">
              
  <img
    src={logo}
    alt="KANDID Logo"
    className="h-12 w-12 object-contain"
  />                                                                      {/*added logo image here (July 15, 2026) */}

              <div className="sidebar-reveal min-w-0">
                <p className="menu-brand-title">KANDID</p>
                <p className="menu-brand-copy">Electoral Board</p>
              </div>
            </div>
            <div className="sidebar-brand-copy">
              <p className="mt-4 menu-brand-copy">Set up Elections and Monitor the Organization.</p>
            </div>
          </div>

          <nav className="sidebar-nav-scroll">
            {boardMenuGroups.map((group, groupIndex) => {
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


{/*main content area*/}

        <main className="workspace-main"> 

          {/*header area*/}
          <header className="glass-panel shell-header fade-up"> 
            <div className="glass-panel-strong shell-search lg:max-w-xl">
              <Search size={18} className="text-gray-400" />
              <input
                placeholder="Search elections, candidates, reports..."
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
                    alt="Board profile"
                    className="h-12 w-12 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-sm font-black text-[#11806a]">
                    EB
                  </div>
                )}
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-bold text-[#18212b]">
                    {user?.full_name || "Electoral Board"}
                  </p>
                  <p className="surface-subcopy truncate text-xs">
                    {user?.organizations?.name || "Assigned Organization"}
                  </p>
                </div>
              </button>
            </div>
          </header>

          <section className="content-stack">
            <Outlet />
          </section>
        </main>
      </div>

      <MobileNav items={mobileMenuItems} />
    </div>
  );
}

export default BoardLayout;
