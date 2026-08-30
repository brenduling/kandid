import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PWAUpdatePrompt from "./components/PWAUpdatePrompt";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import PWAOfflineNotice from "./components/PWAOfflineNotice";
import { KandidRouteLoader } from "./components/KandidLoader";

import ProtectedRoute from "./components/ProtectedRoute";
import { PromptProvider } from "./context/PromptContext";

const Home = lazy(() => import("./pages/Home"));
const RoleLanding = lazy(() => import("./pages/RoleLanding"));
const SuperAdminLayout = lazy(() => import("./layouts/SuperAdminLayout"));
const StudentLayout = lazy(() => import("./layouts/StudentLayout"));
const BoardLayout = lazy(() => import("./layouts/BoardLayout"));

const StudentDashboard = lazy(() => import("./pages/student/Dashboard"));
const StudentElections = lazy(() => import("./pages/student/Elections"));
const StudentOrganizations = lazy(() => import("./pages/student/Organizations"));
const StudentVotePage = lazy(() => import("./pages/student/VotePage"));
const StudentReceipt = lazy(() => import("./pages/student/Receipt"));
const StudentCampaign = lazy(() => import("./pages/student/Campaign"));
const StudentResults = lazy(() => import("./pages/student/Results"));
const StudentOfficers = lazy(() => import("./pages/student/Officers"));
const StudentSetup = lazy(() => import("./pages/auth/StudentSetup"));
const ProfilePage = lazy(() => import("./pages/shared/Profile"));
const KioskVoting = lazy(() => import("./pages/shared/KioskVoting"));
const SearchPage = lazy(() => import("./pages/shared/SearchPage"));

const BoardDashboard = lazy(() => import("./pages/board/Dashboard"));
const BoardElections = lazy(() => import("./pages/board/Elections"));
const BoardStudents = lazy(() => import("./pages/board/Students"));
const BoardCSVImport = lazy(() => import("./pages/board/CSVImport"));
const BoardPositions = lazy(() => import("./pages/board/Positions.jsx"));
const BoardCandidates = lazy(() => import("./pages/board/Candidates"));
const BoardOfficers = lazy(() => import("./pages/board/Officers"));
const BoardPartylists = lazy(() => import("./pages/board/Partylists"));
const BoardEligibilityRules = lazy(() => import("./pages/board/EligibilityRules"));
const BoardVotingMonitor = lazy(() => import("./pages/board/VotingMonitor"));
const BoardResults = lazy(() => import("./pages/board/Results"));
const BoardReports = lazy(() => import("./pages/board/Reports"));

const Dashboard = lazy(() => import("./pages/superadmin/Dashboard"));
const Organizations = lazy(() => import("./pages/superadmin/Organizations"));
const Students = lazy(() => import("./pages/superadmin/Students"));
const CSVImport = lazy(() => import("./pages/superadmin/CSVImport"));
const Elections = lazy(() => import("./pages/superadmin/Elections"));
const Positions = lazy(() => import("./pages/superadmin/Positions"));
const Candidates = lazy(() => import("./pages/superadmin/Candidates"));
const Officers = lazy(() => import("./pages/superadmin/Officers"));
const Partylists = lazy(() => import("./pages/superadmin/Partylists"));
const EligibilityRules = lazy(() => import("./pages/superadmin/EligibilityRules"));
const VotingMonitor = lazy(() => import("./pages/superadmin/VotingMonitor"));
const Results = lazy(() => import("./pages/superadmin/Results"));
const BlockchainVerification = lazy(() => import("./pages/superadmin/BlockchainVerification"));
const Reports = lazy(() => import("./pages/superadmin/Reports"));
const AuditLogs = lazy(() => import("./pages/superadmin/AuditLogs"));
const UsersRoles = lazy(() => import("./pages/superadmin/UsersRoles"));
const Archives = lazy(() => import("./pages/superadmin/ArchivePage"));
const SystemSettings = lazy(() => import("./pages/superadmin/SystemSettings"));

const AdminLogin = lazy(() => import("./pages/auth/AdminLogin"));
const BoardLogin = lazy(() => import("./pages/auth/BoardLogin"));
const StudentLogin = lazy(() => import("./pages/auth/StudentLogin"));

function RouteFallback() {
  return <KandidRouteLoader message="Opening your workspace..." />;
}

function App() {
  return (
    <BrowserRouter>
      <PromptProvider>

        {/* GLOBAL PWA UPDATE NOTIFICATION */}
        <PWAUpdatePrompt />
        <PWAInstallPrompt />
        <PWAOfflineNotice />

        <Suspense fallback={<RouteFallback />}>
        <Routes>

          {/* ENTRY ROUTES */}
          <Route
            path="/admin-login"
            element={<AdminLogin />}
          />

          <Route
            path="/eb-login"
            element={<BoardLogin />}
          />

          <Route
            path="/board-login"
            element={<BoardLogin />}
          />

          <Route
            path="/student-login"
            element={<StudentLogin />}
          />

          {/* DEFAULT */}
          <Route
            path="/"
            element={<RoleLanding role="student" />}
          />

          <Route
            path="/home"
            element={<Home />}
          />

          <Route
            path="/board-portal"
            element={<RoleLanding role="board" />}
          />

          <Route
            path="/admin"
            element={<RoleLanding role="admin" />}
          />

          {/* SUPER ADMIN (PROTECTED) */}
          <Route
            path="/super-admin"
            element={
              <ProtectedRoute role="super_admin">
                <SuperAdminLayout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={<Navigate to="dashboard" replace />}
            />

            <Route
              path="dashboard"
              element={<Dashboard />}
            />

            <Route
              path="organizations"
              element={<Organizations />}
            />

            <Route
              path="search"
              element={<SearchPage />}
            />

            <Route
              path="students"
              element={<Students />}
            />

            <Route
              path="csv-import"
              element={<CSVImport />}
            />

            <Route
              path="elections"
              element={<Elections />}
            />

            <Route
              path="positions"
              element={<Positions />}
            />

            <Route
              path="candidates"
              element={<Candidates />}
            />

            <Route
              path="officers"
              element={<Officers />}
            />

            <Route
              path="partylists"
              element={<Partylists />}
            />

            <Route
              path="eligibility-rules"
              element={<EligibilityRules />}
            />

            <Route
              path="voting-monitor"
              element={<VotingMonitor />}
            />

            <Route
              path="results"
              element={<Results />}
            />

            <Route
              path="blockchain"
              element={<BlockchainVerification />}
            />

            <Route
              path="kiosk"
              element={<KioskVoting />}
            />

            <Route
              path="reports"
              element={<Reports />}
            />

            <Route
              path="audit-logs"
              element={<AuditLogs />}
            />

            <Route
              path="users-roles"
              element={<UsersRoles />}
            />

            <Route
              path="archives"
              element={<Archives />}
            />

            <Route
              path="settings"
              element={<SystemSettings />}
            />

            <Route
              path="profile"
              element={<ProfilePage />}
            />
          </Route>

          {/* ELECTORAL BOARD (PROTECTED) */}
          <Route
            path="/board"
            element={
              <ProtectedRoute role="electoral_board">
                <BoardLayout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={<Navigate to="dashboard" replace />}
            />

            <Route
              path="dashboard"
              element={<BoardDashboard />}
            />

            <Route
              path="elections"
              element={<BoardElections />}
            />

            <Route
              path="search"
              element={<SearchPage />}
            />

            <Route
              path="positions"
              element={<BoardPositions />}
            />

            <Route
              path="candidates"
              element={<BoardCandidates />}
            />

            <Route
              path="officers"
              element={<BoardOfficers />}
            />

            <Route
              path="partylists"
              element={<BoardPartylists />}
            />

            <Route
              path="eligibility-rules"
              element={<BoardEligibilityRules />}
            />

            <Route
              path="voting-monitor"
              element={<BoardVotingMonitor />}
            />

            <Route
              path="results"
              element={<BoardResults />}
            />

            <Route
              path="kiosk"
              element={<KioskVoting />}
            />

            <Route
              path="reports"
              element={<BoardReports />}
            />

            <Route
              path="students"
              element={<BoardStudents />}
            />

            <Route
              path="csv-import"
              element={<BoardCSVImport />}
            />

            <Route
              path="profile"
              element={<ProfilePage />}
            />
          </Route>

          {/* STUDENT (PROTECTED) */}
          <Route
            path="/student"
            element={
              <ProtectedRoute role="student">
                <StudentLayout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={<Navigate to="dashboard" replace />}
            />

            <Route
              path="dashboard"
              element={<StudentDashboard />}
            />

            <Route
              path="elections"
              element={<StudentElections />}
            />

            <Route
              path="organizations"
              element={<StudentOrganizations />}
            />

            <Route
              path="search"
              element={<SearchPage />}
            />

            <Route
              path="elections/:electionId/campaign"
              element={<StudentCampaign />}
            />

            <Route
              path="vote/:electionId"
              element={<StudentVotePage />}
            />

            <Route
              path="officers"
              element={<StudentOfficers />}
            />

            <Route
              path="results"
              element={<StudentResults />}
            />

            <Route
              path="receipt"
              element={<StudentReceipt />}
            />

            <Route
              path="profile"
              element={<ProfilePage />}
            />
          </Route>

          {/* STUDENT SETUP */}
          <Route
            path="/student-setup"
            element={<StudentSetup />}
          />

        </Routes>
        </Suspense>

      </PromptProvider>
    </BrowserRouter>
  );
}

export default App;
