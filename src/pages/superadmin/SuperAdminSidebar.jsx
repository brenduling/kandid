import { NavLink } from "react-router-dom";

const links = [
  { name: "Dashboard", path: "/super-admin" },
  { name: "Organizations", path: "/super-admin/organizations" },
  { name: "Students", path: "/super-admin/students" },
  { name: "CSV Import", path: "/super-admin/csv-import" },
  { name: "Elections", path: "/super-admin/elections" },
  { name: "Candidates", path: "/super-admin/candidates" },
  { name: "Eligibility Rules", path: "/super-admin/eligibility-rules" },
  { name: "Voting Monitor", path: "/super-admin/voting-monitor" },
  { name: "Results", path: "/super-admin/results" },
  { name: "Blockchain", path: "/super-admin/blockchain-verification" },
  { name: "Reports", path: "/super-admin/reports" },
  { name: "Audit Logs", path: "/super-admin/audit-logs" },
  { name: "Electoral Board Access", path: "/super-admin/users-roles" },
  { name: "Archives", path: "/super-admin/archives" },
  { name: "Settings", path: "/super-admin/system-settings" },
];

function SuperAdminSidebar() {
  return (
    <aside className="w-72 min-h-screen bg-[#1f1f1f] text-white px-5 py-6">
      <div className="mb-10">
        <h1 className="text-2xl font-black text-[#ff6a2a]">KANDID</h1>
        <p className="text-xs text-gray-400 mt-1">Super Admin Console</p>
      </div>

      <nav className="space-y-1">
        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            end={link.path === "/super-admin"}
            className={({ isActive }) =>
              `block px-4 py-3 rounded-xl text-sm font-semibold transition ${
                isActive
                  ? "bg-[#ff6a2a] text-white"
                  : "text-gray-300 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            {link.name}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export default SuperAdminSidebar;
