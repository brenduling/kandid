import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PWAUpdatePrompt from "./components/PWAUpdatePrompt";

// layouts
import Home from "./pages/Home";
import SuperAdminLayout from "./layouts/SuperAdminLayout";
import StudentLayout from "./layouts/StudentLayout";
import BoardLayout from "./layouts/BoardLayout";

// student pages
import StudentDashboard from "./pages/student/Dashboard";
import StudentElections from "./pages/student/Elections";
import StudentVotePage from "./pages/student/VotePage";
import StudentReceipt from "./pages/student/Receipt";
import StudentCampaign from "./pages/student/Campaign";
import StudentResults from "./pages/student/Results";
import StudentOfficers from "./pages/student/Officers";
import StudentSetup from "./pages/auth/StudentSetup";
import ProfilePage from "./pages/shared/Profile";
import KioskVoting from "./pages/shared/KioskVoting";

// board pages
import BoardDashboard from "./pages/board/Dashboard";
import BoardElections from "./pages/board/Elections";
import BoardStudents from "./pages/board/Students";
import BoardCSVImport from "./pages/board/CSVImport";
import BoardPositions from "./pages/board/Positions.jsx";
import BoardCandidates from "./pages/board/Candidates";
import BoardOfficers from "./pages/board/Officers";
import BoardPartylists from "./pages/board/Partylists";
import BoardEligibilityRules from "./pages/board/EligibilityRules";
import BoardVotingMonitor from "./pages/board/VotingMonitor";
import BoardResults from "./pages/board/Results";
import BoardReports from "./pages/board/Reports";

// admin pages
import Dashboard from "./pages/superadmin/Dashboard";
import Organizations from "./pages/superadmin/Organizations";
import Students from "./pages/superadmin/Students";
import CSVImport from "./pages/superadmin/CSVImport";
import Elections from "./pages/superadmin/Elections";
import Positions from "./pages/superadmin/Positions";
import Candidates from "./pages/superadmin/Candidates";
import Officers from "./pages/superadmin/Officers";
import Partylists from "./pages/superadmin/Partylists";
import EligibilityRules from "./pages/superadmin/EligibilityRules";
import VotingMonitor from "./pages/superadmin/VotingMonitor";
import Results from "./pages/superadmin/Results";
import BlockchainVerification from "./pages/superadmin/BlockchainVerification";
import Reports from "./pages/superadmin/Reports";
import AuditLogs from "./pages/superadmin/AuditLogs";
import UsersRoles from "./pages/superadmin/UsersRoles";
import Archives from "./pages/superadmin/ArchivePage";
import SystemSettings from "./pages/superadmin/SystemSettings";

// login pages
import AdminLogin from "./pages/auth/AdminLogin";
import BoardLogin from "./pages/auth/BoardLogin";
import StudentLogin from "./pages/auth/StudentLogin";

import ProtectedRoute from "./components/ProtectedRoute";
import { PromptProvider } from "./context/PromptContext";

function App() {
  return (
    <BrowserRouter>
      <PromptProvider>

        {/* GLOBAL PWA UPDATE NOTIFICATION */}
        <PWAUpdatePrompt />

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
            element={<Home />}
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

      </PromptProvider>
    </BrowserRouter>
  );
}

export default App;