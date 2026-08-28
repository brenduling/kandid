import { useEffect, useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Search,
} from "lucide-react";

import MobileNav from "../components/MobileNav";
import NotificationCenter from "../components/NotificationCenter";

import logo from "../assets/kandidlogo.png";

import {
  clearStoredUser,
  getStoredUser,
} from "../utils/auth";

import {
  getProfileRoute,
} from "../utils/profile";

import {
  studentMenuItems,
} from "../config/navigation";

import {
  usePrompt,
} from "../context/PromptContext";

function StudentLayout() {
  const navigate = useNavigate();

  /*
   * Keep the stored user stable for the lifetime
   * of the layout.
   */
  const user = useMemo(
    () => getStoredUser(),
    []
  );

  const prompt = usePrompt();

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

  /*
   * ============================================================
   * LOGOUT
   * ============================================================
   */
  async function handleLogout() {
    const ok = await prompt.confirm({
      title: "Logout Confirmation",

      message:
        "Are you sure you want to sign out of the Student Portal?",

      type: "warning",

      confirmText: "Logout",
    });

    if (!ok) return;

    clearStoredUser();

    navigate(
      "/student-login",
      {
        replace: true,
      }
    );
  }

  return (
    <div className="student-theme kandid-app-theme min-h-screen bg-[#f6f7f9] text-[#111827]">
      {/* ======================================================
          DESKTOP SIDEBAR
          ====================================================== */}
      <aside className="student-sidebar">
        {/* BRAND */}
        <div className="student-sidebar-brand">
          <img
            src={logo}
            alt="KANDID Logo"
          />

          <div>
            <strong>
              KANDID
            </strong>

            <span>
              Student Portal
            </span>
          </div>
        </div>

        {/* NAVIGATION */}
        <nav className="student-sidebar-nav">
          {studentMenuItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `student-sidebar-link ${isActive
                    ? "student-sidebar-link-active"
                    : ""
                  }`
                }
              >
                <Icon size={16} />

                <span>
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
          className="student-sidebar-logout"
        >
          <LogOut size={16} />

          Logout
        </button>
      </aside>

      {/* ======================================================
          MAIN
          ====================================================== */}
      <main className="student-main">
        {/* ====================================================
            TOP BAR
            ==================================================== */}
        <header className="student-topbar">
          {/* SEARCH */}
          <div className="student-search">
            <Search size={15} />

            <input
              type="search"
              placeholder="Search users, organizations, elections, logs..."
              aria-label="Search"
            />
          </div>

          {/* ACTIONS */}
          <div className="student-topbar-actions">
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
              className="student-profile-chip"
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
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt="Student profile"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="student-profile-avatar">
                  {user?.first_name?.[0] ||
                    "S"}

                  {user?.last_name?.[0] ||
                    "A"}
                </span>
              )}

              <ChevronDown
                size={15}
              />
            </button>
          </div>
        </header>

        {/* ====================================================
            PAGE CONTENT
            ==================================================== */}
        <section className="student-content">
          <Outlet />
        </section>
      </main>

      {/* ======================================================
          MOBILE NAVIGATION
          ====================================================== */}
      <MobileNav
        items={studentMenuItems}
        onLogout={handleLogout}
        organizationLogo={logo}
        organizationName="KANDID"
      />
    </div>
  );
}

export default StudentLayout;
