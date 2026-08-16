import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Search } from "lucide-react";
import MobileNav from "../components/MobileNav";
import NotificationCenter from "../components/NotificationCenter";
import logo from "../assets/kandidlogo.png";
import { clearStoredUser, getStoredUser } from "../utils/auth";
import { getProfileRoute } from "../utils/profile";
import { studentMenuItems } from "../config/navigation";

function StudentLayout() {
  const navigate = useNavigate();
  const user = getStoredUser();

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
    <div className="student-theme min-h-screen bg-[#f6f7f9] text-[#111827]">
      <aside className="student-sidebar">
        <div className="student-sidebar-brand">
          <img src={logo} alt="KANDID Logo" />
          <div>
            <strong>KANDID</strong>
            <span>Student Portal</span>
          </div>
        </div>

        <nav className="student-sidebar-nav">
          {studentMenuItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `student-sidebar-link ${isActive ? "student-sidebar-link-active" : ""}`
                }
              >
                <Icon size={16} />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        <button onClick={handleLogout} className="student-sidebar-logout">
          <LogOut size={16} />
          Logout
        </button>
      </aside>

      <main className="student-main">
        <header className="student-topbar">
          <div className="student-search">
            <Search size={15} />
            <input placeholder="Search users, organizations, elections, logs..." />
          </div>

          <div className="student-topbar-actions">
            <NotificationCenter user={user} />
            <button
              onClick={() => navigate(getProfileRoute(user?.role))}
              className="student-profile-chip"
            >
              <div className="student-profile-copy">
                <strong>
                  {user?.first_name || "Student"} {user?.last_name || ""}
                </strong>
                <span>Student</span>
              </div>
              {user?.photo_url ? (
                <img src={user.photo_url} alt="Student profile" />
              ) : (
                <span className="student-profile-avatar">
                  {user?.first_name?.[0] || "S"}
                  {user?.last_name?.[0] || "A"}
                </span>
              )}
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <section className="student-content">
          <Outlet />
        </section>
      </main>

      <MobileNav items={studentMenuItems} />
    </div>
  );
}

export default StudentLayout;
