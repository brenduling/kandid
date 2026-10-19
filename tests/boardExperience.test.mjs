import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toBoardFacingError } from "../src/utils/boardFeedback.js";

const prompt = await readFile(new URL("../src/context/PromptContext.jsx", import.meta.url), "utf8");
const boardFeedback = await readFile(new URL("../src/utils/boardFeedback.js", import.meta.url), "utf8");
const feedbackCss = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/pages/board/Dashboard.jsx", import.meta.url), "utf8");
const dashboardCss = await readFile(new URL("../src/pages/board/Dashboard.css", import.meta.url), "utf8");
const students = await readFile(new URL("../src/pages/board/Students.jsx", import.meta.url), "utf8");
const elections = await readFile(new URL("../src/pages/board/Elections.jsx", import.meta.url), "utf8");
const reports = await readFile(new URL("../src/pages/board/Reports.jsx", import.meta.url), "utf8");
const monitor = await readFile(new URL("../src/pages/board/VotingMonitor.jsx", import.meta.url), "utf8");
const results = await readFile(new URL("../src/pages/board/Results.jsx", import.meta.url), "utf8");
const candidateManagement = await readFile(new URL("../src/components/CandidateManagement.jsx", import.meta.url), "utf8");
const profile = await readFile(new URL("../src/pages/shared/Profile.jsx", import.meta.url), "utf8");
const profileCss = await readFile(new URL("../src/pages/shared/Profile.css", import.meta.url), "utf8");
const notifications = await readFile(new URL("../src/pages/shared/NotificationsPage.jsx", import.meta.url), "utf8");
const notificationUtils = await readFile(new URL("../src/utils/notifications.js", import.meta.url), "utf8");

test("Board actions use the shared accessible Kandid feedback and confirmation layer", () => {
  assert.match(prompt, /useLocation\(\)/);
  assert.match(prompt, /location\.pathname === "\/board" \|\| location\.pathname\.startsWith\("\/board\/"\)/);
  assert.match(prompt, /location\.pathname !== "\/board\/kiosk"/);
  assert.match(prompt, /kandid-toast-viewport\$\{isBoardPortal \? " is-board-feedback"/);
  assert.match(prompt, /variant: opts\.variant \|\| \(isBoardPortal \? "editorial"/);
  assert.match(prompt, /variant: isBoardPortal \? "editorial" : undefined/);
  assert.match(prompt, /aria-labelledby="kandid-prompt-title"/);
  assert.match(prompt, /aria-describedby="kandid-prompt-description"/);
  assert.match(prompt, /role=\{t\.type === "error" \? "alert" : "status"\}/);
  assert.match(prompt, /aria-live=\{t\.type === "error" \? "assertive" : "polite"\}/);
  assert.match(prompt, /toBoardFacingError\(opts\.message\)/);
  assert.match(prompt, /7000 : opts\.type === "warning" \? 6000 : 4000/);
  assert.match(prompt, /slice\(-3\)/);
  assert.match(prompt, /useReducedMotion/);
  assert.match(feedbackCss, /\.kandid-toast-viewport\.is-board-feedback/);
  assert.match(feedbackCss, /max-height: min\(38dvh, 19rem\)/);
  assert.match(feedbackCss, /@media \(max-width: 640px\)/);
  assert.match(boardFeedback, /PGRST/);
  assert.match(boardFeedback, /contact a system administrator/);
  assert.match(boardFeedback, /That action could not be completed/);
});

test("Board profile has its own structure-shaped loading state and reduced-motion behavior", () => {
  assert.match(profile, /board-profile-loading/);
  assert.match(profile, /Loading Board profile/);
  assert.match(profileCss, /board-profile-loading-identity/);
  assert.match(profileCss, /prefers-reduced-motion: reduce/);
});

test("Board error copy preserves useful messages and hides database implementation details", () => {
  assert.equal(toBoardFacingError("The election is already closed."), "The election is already closed.");
  assert.match(toBoardFacingError("PGRST204: Could not find column in schema cache"), /contact a system administrator/);
  assert.match(toBoardFacingError("new row violates row-level security policy for table candidates"), /contact a system administrator/);
  assert.match(toBoardFacingError("TypeError: Failed to fetch"), /try again/);
});

test("Board notifications distinguish loading, empty, error, and mark-read pending states", () => {
  assert.match(notifications, /board-notifications-skeleton/);
  assert.match(notifications, /Notifications could not be loaded/);
  assert.match(notifications, /Nothing needs your attention/);
  assert.match(notifications, /Election activity and important Board notices will appear here/);
  assert.match(notifications, /unreadCount > 0/);
  assert.doesNotMatch(notificationUtils, /No urgent board alerts|board-empty/);
  assert.match(notifications, /markingAllRead/);
  assert.match(notifications, /Marking read…/);
  assert.match(notifications, /VOTING \/ ELECTION/);
  assert.match(notifications, /CAST MY VOTE/);
  assert.match(notifications, /VIEW RESULTS/);
});

test("Dashboard follows the Students header and has distinct load, error, and empty states", () => {
  assert.match(dashboard, /board-dashboard-context-rule/);
  assert.match(dashboard, /<h1 className="page-title board-dashboard-title">Dashboard<\/h1>/);
  assert.match(dashboard, /board-dashboard-standfirst/);
  assert.match(dashboard, /<DashboardSkeleton \/>/);
  assert.match(dashboard, /board-dashboard-load-error/);
  assert.match(dashboard, /No elections found for this organization\./);
  assert.match(dashboard, /No recent activity yet\./);
  assert.match(dashboard, /activityError/);
  assert.match(dashboard, /Promise\.all\(\[/);
  assert.doesNotMatch(dashboard, /setTimeout\(/);
  assert.match(dashboardCss, /board-dashboard-skeleton-metrics/);
  assert.match(dashboardCss, /prefers-reduced-motion: reduce/);
});

test("major Board registries render structure-specific loading states", () => {
  assert.match(students, /board-students-skeleton/);
  assert.match(elections, /board-elections-skeleton/);
  assert.match(reports, /board-reports-register-skeleton/);
  assert.match(reports, /board-reports-package-skeleton/);
  assert.match(monitor, /board-voting-summary-skeleton/);
  assert.match(monitor, /className="board-voting-summary-skeleton"[\s\S]*?role="status"[\s\S]*?aria-label="Loading ballot summary"/);
  assert.match(results, /board-results-skeleton/);
  assert.match(candidateManagement, /board-candidate-context-skeleton/);
  assert.match(candidateManagement, /board-candidate-register-skeleton/);
});
