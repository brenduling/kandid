import {
  Archive,
  BadgeCheck,
  BarChart3,
  Blocks,
  Building2,
  ClipboardList,
  FileText,
  FileUp,
  Flag,
  Gavel,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  ScrollText,
  Settings,
  Settings2,
  ShieldCheck,
  Trophy,
  UserCheck,
  UserCog,
  Users,
  Vote,
} from "lucide-react";

export const superAdminMenuGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", path: "/super-admin/dashboard", icon: LayoutDashboard },
      { name: "Organizations", path: "/super-admin/organizations", icon: Building2 },
      { name: "Students", path: "/super-admin/students", icon: Users },
      { name: "CSV Import", path: "/super-admin/csv-import", icon: FileUp },
    ],
  },
  {
    label: "Election Operations",
    items: [
      { name: "Elections", path: "/super-admin/elections", icon: Vote },
      { name: "Positions", path: "/super-admin/positions", icon: ListChecks },
      { name: "Candidates", path: "/super-admin/candidates", icon: UserCheck },
      { name: "Officers", path: "/super-admin/officers", icon: BadgeCheck },
      { name: "Partylists", path: "/super-admin/partylists", icon: Flag },
      { name: "Eligibility Rules", path: "/super-admin/eligibility-rules", icon: Gavel },
      { name: "Voting Monitor", path: "/super-admin/voting-monitor", icon: BarChart3 },
      { name: "Kiosk Voting", path: "/super-admin/kiosk", icon: MonitorSmartphone },
      { name: "Results", path: "/super-admin/results", icon: ClipboardList },
      { name: "Blockchain", path: "/super-admin/blockchain", icon: Blocks },
      { name: "Reports", path: "/super-admin/reports", icon: ScrollText },
    ],
  },
  {
    label: "System Control",
    items: [
      { name: "Audit Logs", path: "/super-admin/audit-logs", icon: ShieldCheck },
      { name: "Electoral Board Access", path: "/super-admin/users-roles", icon: UserCog },
      { name: "Archives", path: "/super-admin/archives", icon: Archive },
      { name: "System Settings", path: "/super-admin/settings", icon: Settings },
      { name: "Profile", path: "/super-admin/profile", icon: Settings2 },
    ],
  },
];

export const boardMenuGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", path: "/board/dashboard", icon: LayoutDashboard },
      { name: "Students", path: "/board/students", icon: Users },
      { name: "CSV Import", path: "/board/csv-import", icon: FileUp },
    ],
  },
  {
    label: "Election Operations",
    items: [
      { name: "Elections", path: "/board/elections", icon: Vote },
      { name: "Positions", path: "/board/positions", icon: ListChecks },
      { name: "Candidates", path: "/board/candidates", icon: UserCheck },
      { name: "Officers", path: "/board/officers", icon: BadgeCheck },
      { name: "Partylists", path: "/board/partylists", icon: Flag },
      { name: "Eligibility Rules", path: "/board/eligibility-rules", icon: Gavel },
      { name: "Voting Monitor", path: "/board/voting-monitor", icon: BarChart3 },
      { name: "Kiosk Voting", path: "/board/kiosk", icon: MonitorSmartphone },
      { name: "Results", path: "/board/results", icon: ClipboardList },
      { name: "Reports", path: "/board/reports", icon: ScrollText },
    ],
  },
  {
    label: "Account",
    items: [{ name: "Profile", path: "/board/profile", icon: Settings2 }],
  },
];

export const studentMenuItems = [
  { name: "Home", path: "/student/dashboard", icon: LayoutDashboard },
  { name: "Elections", path: "/student/elections", icon: Vote },
  { name: "Results", path: "/student/results", icon: Trophy },
  { name: "Officers", path: "/student/officers", icon: BadgeCheck },
  { name: "Receipts", path: "/student/receipt", icon: FileText },
  { name: "Settings", path: "/student/profile", icon: Settings2 },
];

export function flattenMenuGroups(menuGroups) {
  return menuGroups.flatMap((group) => group.items);
}

export const superAdminPrimaryNav = [
  { name: "Home", path: "/super-admin/dashboard", icon: LayoutDashboard },
  { name: "Orgs", path: "/super-admin/organizations", icon: Building2 },
  { name: "Students", path: "/super-admin/students", icon: Users },
  { name: "Elections", path: "/super-admin/elections", icon: Vote },
];

export const boardPrimaryNav = [
  { name: "Home", path: "/board/dashboard", icon: LayoutDashboard },
  { name: "Elections", path: "/board/elections", icon: Vote },
  { name: "Students", path: "/board/students", icon: Users },
  { name: "Reports", path: "/board/reports", icon: ScrollText },
];

export const studentPrimaryNav = [
  { name: "Home", path: "/student/dashboard", icon: LayoutDashboard },
  { name: "Elections", path: "/student/elections", icon: Vote },
  { name: "Receipt", path: "/student/receipt", icon: FileText },
  { name: "Settings", path: "/student/profile", icon: Settings2 },
];
