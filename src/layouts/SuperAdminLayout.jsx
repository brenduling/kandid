import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  FileUp,
  Vote,
  ListChecks,
  UserCheck,
  ShieldCheck,
  BarChart3,
  ScrollText,
  Settings,
  Archive,
  UserCog,
  Blocks,
  ClipboardList,
  Flag,
  Gavel,
  Bell,
  Search,
  LogOut,
} from "lucide-react";

const menuItems = [
  { name: "Dashboard", path: "/super-admin/dashboard", icon: LayoutDashboard },
  { name: "Organizations", path: "/super-admin/organizations", icon: Building2 },
  { name: "Students", path: "/super-admin/students", icon: Users },
  { name: "CSV Import", path: "/super-admin/csv-import", icon: FileUp },
  { name: "Elections", path: "/super-admin/elections", icon: Vote },
  { name: "Positions", path: "/super-admin/positions", icon: ListChecks },
  { name: "Candidates", path: "/super-admin/candidates", icon: UserCheck },
  { name: "Partylists", path: "/super-admin/partylists", icon: Flag },
  { name: "Eligibility Rules", path: "/super-admin/eligibility-rules", icon: Gavel },
  { name: "Voting Monitor", path: "/super-admin/voting-monitor", icon: BarChart3 },
  { name: "Results", path: "/super-admin/results", icon: ClipboardList },
  { name: "Blockchain", path: "/super-admin/blockchain", icon: Blocks },
  { name: "Reports", path: "/super-admin/reports", icon: ScrollText },
  { name: "Audit Logs", path: "/super-admin/audit-logs", icon: ShieldCheck },
  { name: "Users & Roles", path: "/super-admin/users-roles", icon: UserCog },
  { name: "Archives", path: "/super-admin/archives", icon: Archive },
  { name: "System Settings", path: "/super-admin/settings", icon: Settings },
];

function SuperAdminLayout() {
  return (
    <div className="min-h-screen bg-[#f6f3ef] flex">
      <aside className="w-72 bg-[#1d1d1d] text-white flex flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <h1 className="text-xl font-black text-[#ff5a1f]">KANDID</h1>
          <p className="text-xs text-white/50 mt-1">Super Admin Console</p>
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
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white/70 hover:bg-white/10">
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
              placeholder="Search anything..."
            />
          </div>

          <div className="flex items-center gap-5">
            <Bell size={20} className="text-gray-600" />
            <div className="text-right">
              <p className="text-sm font-bold">Super Admin</p>
              <p className="text-xs text-gray-500">System Administrator</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#ff5a1f] text-white flex items-center justify-center font-bold">
              SA
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

export default SuperAdminLayout;