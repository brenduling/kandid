import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Vote,
  UserCheck,
  BarChart3,
  ClipboardList,
  LogOut,
  Bell,
  Search,
  ListChecks,
  Flag,
  Gavel,
  ScrollText,
  Users,
  FileUp
} from "lucide-react";

const menuItems = [
  { name: "Dashboard", path: "/board/dashboard", icon: LayoutDashboard },
  { name: "Elections", path: "/board/elections", icon: Vote },
  { name: "Positions", path: "/board/positions", icon: ListChecks },
  { name: "Candidates", path: "/board/candidates", icon: UserCheck },
  { name: "Partylists", path: "/board/partylists", icon: Flag },
  { name: "Eligibility Rules", path: "/board/eligibility-rules", icon: Gavel },
  { name: "Voting Monitor", path: "/board/voting-monitor", icon: BarChart3 },
  { name: "Results", path: "/board/results", icon: ClipboardList },
  { name: "Reports", path: "/board/reports", icon: ScrollText },
  { name: "Students", path: "/board/students", icon: Users },
  { name: "CSV Import", path: "/board/csv-import", icon: FileUp },
];

function BoardLayout() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    if (!user || user.role !== "electoral_board") {
      navigate("/board-login");
    }
  }, [navigate, user]);

  function handleLogout() {
    const confirmLogout = window.confirm("Are you sure you want to logout?");
    if (!confirmLogout) return;

    localStorage.removeItem("user");
    navigate("/board-login");
  }

  return (
    <div className="min-h-screen bg-[#f6f3ef] flex">
      <aside className="w-72 bg-[#1d1d1d] text-white flex flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <h1 className="text-xl font-black text-[#ff5a1f]">KANDID</h1>
          <p className="text-xs text-white/50 mt-1">Electoral Board Console</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
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

      <main className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b flex items-center justify-between px-8">
          <div className="flex items-center gap-3 bg-[#f6f3ef] px-4 py-2 rounded-full w-96">
            <Search size={18} className="text-gray-400" />
            <input
              className="bg-transparent outline-none text-sm w-full"
              placeholder="Search..."
            />
          </div>

          <div className="flex items-center gap-5">
            <Bell size={20} className="text-gray-600" />

            <div className="text-right">
              <p className="text-sm font-bold">
                {user?.full_name || "Electoral Board"}
              </p>
              <p className="text-xs text-gray-500">
                {user?.organizations?.name || "Assigned Organization"}
              </p>
            </div>

            <div className="w-10 h-10 rounded-full bg-[#ff5a1f] text-white flex items-center justify-center font-bold">
              EB
            </div>
          </div>
        </header>

        <section className="flex-1 p-8 overflow-y-auto">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

export default BoardLayout;