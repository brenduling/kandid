import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Vote,
  FileText,
  LogOut,
  Bell,
} from "lucide-react";

const menuItems = [
  { name: "Dashboard", path: "/student/dashboard", icon: LayoutDashboard },
  { name: "Elections", path: "/student/elections", icon: Vote },
  { name: "My Votes", path: "/student/receipt", icon: FileText },
];

function StudentLayout() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    if (!user || user.role !== "student") {
      navigate("/student-login");
    }
  }, [navigate, user]);

  function handleLogout() {
    const confirmLogout = window.confirm("Logout?");
    if (!confirmLogout) return;

    localStorage.removeItem("user");
    navigate("/student-login");
  }

  return (
    <div className="min-h-screen bg-[#f6f3ef] flex">
      
      {/* SIDEBAR */}
      <aside className="w-72 bg-[#1d1d1d] text-white flex flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <h1 className="text-xl font-black text-[#ff5a1f]">KANDID</h1>
          <p className="text-xs text-white/50 mt-1">Student Portal</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition ${
                    isActive
                      ? "bg-[#ff5a1f] text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon size={18} />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white/70 hover:bg-red-600 hover:text-white transition"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col">
        
        {/* HEADER */}
        <header className="h-16 bg-white border-b flex items-center justify-between px-8">
          <h2 className="font-bold text-lg">Student Portal</h2>

          <div className="flex items-center gap-5">
            <Bell size={20} className="text-gray-600" />

            <div className="text-right">
              <p className="text-sm font-bold">
                {user?.first_name || "Student"} {user?.last_name || ""}
              </p>
              <p className="text-xs text-gray-500">
                {user?.student_number || ""}
              </p>
            </div>

            <div className="w-10 h-10 rounded-full bg-[#ff5a1f] text-white flex items-center justify-center font-bold">
              S
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <section className="flex-1 p-8 overflow-y-auto">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

export default StudentLayout;