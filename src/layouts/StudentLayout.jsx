import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
} from "lucide-react";

import GlobalSearch from "../components/GlobalSearch";
import MobileNav from "../components/MobileNav";
import MobileHeader from "../components/MobileHeader";
import MobileMenu from "../components/MobileMenu";
import NotificationCenter from "../components/NotificationCenter";
import { StudentAvatar } from "../components/KandidImage";


import logo from "../assets/kandidlogo.png";

import {
  getStoredUser,
  signOutStudentSession,
} from "../utils/auth";

import {
  getProfileRoute,
} from "../utils/profile";

import {
  studentMenuItems,
  studentPrimaryNav,
} from "../config/navigation";

import {
  usePrompt,
} from "../context/PromptContext";
import { logAuditEvent } from "../utils/auditLog";

function StudentLayout() {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [user, setUser] = useState(() => getStoredUser());

  const prompt = usePrompt();
  const homePath = "/student/dashboard";

  /*
   * ============================================================
   * AUTHORIZATION
   * ============================================================
   */
  useEffect(() => {
    if (!user || user.role !== "student") {
      navigate(
        "/student-login",
        {
          replace: true,
        }
      );
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

  /*
   * ============================================================
   * LOGOUT
   * ============================================================
   */
  async function handleLogout() {
    const ok = await prompt.confirm({
      eyebrow: "Signing out",
      title: "Leaving Kandid?",
      message:
        "You'll need to sign in again to access your Student Portal.",
      type: "info",
      variant: "editorial",
      confirmText: "Logout",
      cancelText: "Stay signed in",
    });

    if (!ok) return;

    await logAuditEvent({
      action: "logout",
      entityType: "auth",
      entityLabel: "Student Portal",
      status: "completed",
      user,
    });
    await signOutStudentSession();

    navigate(
      "/",
      {
        replace: true,
      }
    );
  }

  return (
    <div className="student-theme kandid-app-theme app-shell min-h-screen bg-[#f6f7f9] text-[#111827]">
      {/* ======================================================
          DESKTOP SIDEBAR
          ====================================================== */}
      <aside className="student-sidebar shell-sidebar shell-sidebar-collapsible">
        {/* BRAND */}
        <button
          type="button"
          onClick={() => navigate(homePath)}
          className="student-sidebar-brand kandid-sidebar-brand-button"
          aria-label="Go to student home"
        >
          <img
            src={logo}
            alt="KANDID Logo"
          />

          <div>
            <strong>
              KANDID
            </strong>

            <span>
              STUDENT
            </span>
          </div>
        </button>

        {/* NAVIGATION */}
        <nav className="student-sidebar-nav">
          {studentMenuItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                aria-label={item.name}
                title={item.name}
                data-tooltip={item.name}
                className={({ isActive }) =>
                  `student-sidebar-link nav-item ${isActive
                    ? "student-sidebar-link-active nav-item-active"
                    : ""
                  }`
                }
              >
                <span className="nav-item-icon">
                  <Icon size={18} />
                </span>

                <span className="sidebar-reveal">
                  {item.name}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* LOGOUT */}
        <button
          type="button"
          onClick={handleLogout}
          className="student-sidebar-logout sidebar-logout-btn"
          aria-label="Logout"
          title="Logout"
          data-tooltip="Logout"
        >
          <span className="nav-item-icon">
            <LogOut size={18} />
          </span>

          <span className="sidebar-reveal">
            Logout
          </span>
        </button>
      </aside>

      {/* ======================================================
          MAIN
          ====================================================== */}
      <main className="student-main workspace-main">
        {/* ====================================================
            TOP BAR
            ==================================================== */}
        <header className="student-topbar kandid-header hidden lg:flex">
          {/* SEARCH */}
          <GlobalSearch
            user={user}
            className="student-search shell-search"
          />

          {/* ACTIONS */}
          <div className="student-topbar-actions kandid-header-actions hidden lg:flex">
            <NotificationCenter
              user={user}
            />

            <button
              type="button"
              onClick={() =>
                navigate(
                  getProfileRoute(
                    user?.role
                  )
                )
              }
              className="student-profile-chip shell-profile-chip"
            >
              {/* USER INFORMATION */}
              <div className="student-profile-copy">
                <strong>
                  {user?.first_name ||
                    "Student"}{" "}
                  {user?.last_name ||
                    ""}
                </strong>

                <span>
                  Student
                </span>
              </div>

              {/* PROFILE IMAGE */}
              <StudentAvatar
                student={user}
                className="student-profile-avatar"
                loading="lazy"
              />

              <ChevronDown
                size={15}
              />
            </button>
          </div>
        </header>

        {/* ====================================================
            PAGE CONTENT
            ==================================================== */}
        <section className="student-content content-stack pb-24 pt-20 lg:pb-8 lg:pt-8">
          <Outlet />
        </section>
      </main>

      {/* ======================================================
          MOBILE HEADER
          ====================================================== */}
      <MobileHeader
        user={user}
        onMenuClick={() => setIsMobileMenuOpen(true)}
        homePath={homePath}
      />

      {/* ======================================================
          MOBILE MENU (DRAWER)
          ====================================================== */}
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        menuGroups={studentMenuItems}
        user={user}
        onLogout={handleLogout}
        title="STUDENT"
      />

      {/* ======================================================
          MOBILE NAVIGATION (BOTTOM)
          ====================================================== */}
      <MobileNav
        primaryItems={studentPrimaryNav}
        onLogout={handleLogout}
      />
    </div>
  );
}

export default StudentLayout;
