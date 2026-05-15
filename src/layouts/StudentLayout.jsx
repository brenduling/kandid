import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BellDot, LogOut, Smartphone } from "lucide-react";
import { clearStoredUser, getStoredUser } from "../utils/auth";
import NotificationCenter from "../components/NotificationCenter";
import MobileNav from "../components/MobileNav";
import { getProfileRoute } from "../utils/profile";
import { studentMenuItems } from "../config/navigation";

const studentRouteMeta = {
  "/student/dashboard": {
    label: "Home",
    title: "Student Dashboard",
    subtitle: "Track your election activity and next voting steps.",
  },
  "/student/elections": {
    label: "Vote",
    title: "Election Feed",
    subtitle: "Review active election windows, campaigns, and ballot access.",
  },
  "/student/officers": {
    label: "Officers",
    title: "Officer Directory",
    subtitle: "Browse current and previous officers across organizations.",
  },
  "/student/results": {
    label: "Results",
    title: "Published Tallies",
    subtitle: "View results once they are released for student access.",
  },
  "/student/receipt": {
    label: "Receipts",
    title: "Vote Records",
    subtitle: "Check your submitted ballots and verification hashes.",
  },
  "/student/profile": {
    label: "Profile",
    title: "My Account",
    subtitle: "Manage your photo, credentials, and account details.",
  },
};

function StudentLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const routeMeta = studentRouteMeta[location.pathname] || {
    label: "KANDID",
    title: "Student Workspace",
    subtitle: "Move through campaigns, voting, receipts, and results.",
  };

  useEffect(() => {
    if (!user || user.role !== "student") {
      navigate("/student-login");
    }
  }, [navigate, user]);

  function handleLogout() {
    if (!window.confirm("Logout?")) return;

    clearStoredUser();
    navigate("/student-login", { replace: true });
  }

  return (
    <div className="app-shell relative overflow-hidden">
      <div className="ambient-orb left-[-90px] top-20 h-72 w-72 bg-[rgba(232,108,47,0.18)]" />
      <div className="ambient-orb bottom-10 right-[-70px] h-80 w-80 bg-[rgba(47,143,131,0.16)]" />

      <div className="shell-layout">
        <aside className="glass-panel-dark shell-sidebar shell-sidebar-collapsible">
          <div className="sidebar-brand-block border-b border-white/10 pb-5">
            <div className="flex items-center justify-center gap-3 lg:justify-start">
              <div className="menu-brand-badge">K</div>
              <div className="sidebar-reveal min-w-0">
                <p className="menu-brand-title">KANDID</p>
                <p className="menu-brand-copy">Student</p>
              </div>
            </div>
            <div className="sidebar-brand-copy">
              <p className="mt-4 menu-brand-copy">Campaigns, ballots, receipts, and results in one place.</p>
            </div>
          </div>

          <nav className="sidebar-nav-scroll">
            <div className="sidebar-group">
              <div className="nav-section-trigger">
                <span className="sidebar-reveal">Student Space</span>
              </div>
              <div className="nav-section-body" data-open="true">
                <div className="nav-section-inner mt-3 space-y-2">
                  {studentMenuItems.map((item, index) => {
                    const Icon = item.icon;

                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                          `fade-up nav-item ${isActive ? "nav-item-active" : ""}`
                        }
                        style={{ animationDelay: `${index * 40}ms` }}
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
          </nav>

          <div className="sidebar-footer-card">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
              Account
            </p>
            <button
              onClick={() => navigate(getProfileRoute(user?.role))}
              className="sidebar-account-trigger mt-3 justify-center lg:justify-start"
            >
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt="Student profile"
                  className="h-12 w-12 rounded-2xl object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(232,108,47,0.18)] text-sm font-black text-[#ffb18c]">
                  {user?.first_name?.[0] || "S"}
                </div>
              )}
              <div className="sidebar-reveal min-w-0">
                <p className="truncate text-sm font-bold text-white">
                  {user?.first_name || "Student"} {user?.last_name || ""}
                </p>
                <p className="truncate text-xs text-white/55">
                  {user?.student_number || "Open profile"}
                </p>
              </div>
            </button>

            <button
              onClick={handleLogout}
              className="sidebar-logout-btn"
            >
              <LogOut size={18} />
              <span className="sidebar-reveal">Logout</span>
            </button>
          </div>
        </aside>

        <main className="workspace-main">
          <header className="glass-panel fade-up overflow-hidden rounded-[30px] px-4 py-4 sm:px-5 lg:rounded-[28px] lg:px-7">
            <div className="flex items-start justify-between gap-4 lg:hidden">
              <div className="min-w-0">
                <div className="secure-badge !bg-[rgba(232,108,47,0.1)] !text-[#d35a25] !border-[rgba(232,108,47,0.14)]">
                  <Smartphone size={13} />
                  {routeMeta.label}
                </div>
                <h2 className="mt-3 text-[1.65rem] font-black tracking-tight text-[#18212b]">
                  {routeMeta.title}
                </h2>
                <p className="surface-subcopy mt-2 text-sm leading-6">
                  {routeMeta.subtitle}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <NotificationCenter user={user} />
                <button
                  onClick={() => navigate(getProfileRoute(user?.role))}
                  className="glass-panel-strong flex h-12 w-12 items-center justify-center rounded-2xl"
                >
                  {user?.photo_url ? (
                    <img
                      src={user.photo_url}
                      alt="Student profile"
                      className="h-12 w-12 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(232,108,47,0.12)] text-sm font-black text-[#d35a25]">
                      {user?.first_name?.[0] || "S"}
                    </div>
                  )}
                </button>
              </div>
            </div>

            <div className="mobile-app-frame mt-5 grid gap-3 lg:hidden">
              <div className="app-panel">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="surface-muted text-xs font-bold uppercase tracking-[0.18em]">
                      Student Account
                    </p>
                    <p className="mt-2 truncate text-base font-black text-[#18212b]">
                      {user?.first_name || "Student"} {user?.last_name || ""}
                    </p>
                    <p className="surface-subcopy mt-1 text-sm">
                      {user?.student_number || "No student number"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[rgba(47,143,131,0.12)] p-3 text-[#2f8f83]">
                    <BellDot size={18} />
                  </div>
                </div>
              </div>

              <div className="mobile-quick-grid">
                {studentMenuItems.slice(0, 4).map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `mobile-quick-tile ${
                          isActive
                            ? "bg-[linear-gradient(135deg,rgba(17,128,106,0.14),rgba(255,255,255,0.96))] shadow-[0_14px_30px_rgba(17,128,106,0.14)]"
                            : ""
                        }`
                      }
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/5 text-[#24313d]">
                        <Icon size={18} />
                      </div>
                      <p className="mt-3 text-[0.82rem] font-black text-[#18212b]">
                        {item.name}
                      </p>
                    </NavLink>
                  );
                })}
              </div>

              <button
                onClick={handleLogout}
                className="secondary-btn !justify-center"
              >
                <LogOut size={16} />
                Exit Student App
              </button>
            </div>

            <div className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4">
              <div>
                <p className="surface-muted text-xs font-bold uppercase tracking-[0.2em]">
                  Student Workspace
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-[#18212b]">
                  Participate with clarity
                </h2>
              </div>

              <div className="flex w-full items-center justify-between gap-3 self-start sm:w-auto sm:justify-end lg:self-auto">
                <NotificationCenter user={user} />

                <button
                  onClick={() => navigate(getProfileRoute(user?.role))}
                  className="glass-panel-strong shell-profile-chip"
                >
                  {user?.photo_url ? (
                    <img
                      src={user.photo_url}
                      alt="Student profile"
                      className="h-12 w-12 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(232,108,47,0.12)] text-sm font-black text-[#d35a25]">
                      {user?.first_name?.[0] || "S"}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-[#18212b]">
                      {user?.first_name || "Student"} {user?.last_name || ""}
                    </p>
                    <p className="surface-subcopy text-xs">{user?.student_number || ""}</p>
                  </div>
                </button>
              </div>
            </div>
          </header>

          <section className="content-stack pb-4">
            <Outlet />
          </section>
        </main>
      </div>

      <MobileNav items={studentMenuItems} />
    </div>
  );
}

export default StudentLayout;
