import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/student/Results.jsx", "utf8");
const styles = readFileSync("src/index.css", "utf8");
const studentResults = readFileSync("src/utils/studentResults.js", "utf8");

test("Student results route trusted backend errors into explicit states instead of raw messages", () => {
  assert.match(page, /import \{[\s\S]*?classifyStudentResultsError,[\s\S]*?\} from "\.\.\/\.\.\/utils\/studentResults"/);
  assert.match(page, /await classifyStudentResultsError\(electionError\)/);
  assert.match(page, /await classifyStudentResultsError\(resultsError\)/);
  assert.doesNotMatch(page, /voteLoadError/);
  assert.doesNotMatch(page, /resultsError\.message/);
  assert.doesNotMatch(page, /Edge Function returned a non-2xx status code/);
  assert.doesNotMatch(page, /JSON\.parse\(localStorage\.getItem\("user"\)\)/);
});

test("Student results separates unreleased, unauthorized, network, zero-vote, and tally states", () => {
  assert.match(page, /function StudentResultsStateBlock/);
  assert.match(page, /!canStudentViewResults\(activeElection\)[\s\S]*?studentAwaitingResultsCopy\(activeElection\)/);
  assert.match(page, /resultErrorCopy[\s\S]*?STUDENT_RESULTS_ERROR_COPY\[resultErrorKind\]/);
  assert.match(page, /!hasGroupedResults[\s\S]*?studentZeroVoteCopy\(activeElection\)/);
  assert.match(page, /electionsErrorCopy[\s\S]*?STUDENT_RESULTS_ERROR_COPY\[electionsErrorKind\]/);
  assert.equal((page.match(/<ResultsLoadingSkeleton \/>/g) || []).length, 2);
  assert.match(studentResults, /title: "Awaiting Official Results"/);
  assert.match(studentResults, /FORBIDDEN: "forbidden"/);
  assert.match(studentResults, /NETWORK: "network"/);
  assert.match(studentResults, /BACKEND: "backend"/);
});

test("Student results supports a manual refresh that also re-reads release state", () => {
  assert.match(page, /const \[refreshNonce, setRefreshNonce\] = useState\(0\)/);
  assert.match(page, /function handleRefreshResults\(\) \{\s*setRefreshNonce\(\(current\) => current \+ 1\);/);
  assert.match(page, /\}, \[user\.id, refreshNonce\]\);/);
  assert.match(page, /className="student-results-refresh"[\s\S]*?Refresh/);
  assert.match(page, /actionLabel="Check again"/);
});

test("Student results gates protected reads before fetching tallies or dimensions", () => {
  const turnoutGate = page.indexOf("const turnoutResult = await loadElectionTurnout(activeElection.id)");
  const resultFetch = page.indexOf("const resultDataset = await fetchElectionResultDataset(activeElection)");
  const dimensionsFetch = page.indexOf("const dimensions = await fetchResultDimensions(activeElection, {");
  assert.ok(turnoutGate >= 0 && resultFetch > turnoutGate && dimensionsFetch > resultFetch);
  assert.match(page.slice(turnoutGate, resultFetch), /if \(turnoutResult\.error\)[\s\S]*?return;/);
  assert.doesNotMatch(page, /Results are unavailable to your account|limited to eligible participants/);
  assert.match(studentResults, /Access could not be verified/);
});

test("Student result dimensions skip unrelated organization membership reads", () => {
  const dimensions = readFileSync("src/utils/resultDimensions.js", "utf8");
  assert.match(page, /includeMembershipDemographics: false/);
  assert.match(dimensions, /includeMembershipDemographics\s*\?\s*fetchMembershipDemographics/);
  assert.doesNotMatch(dimensions, /from\(["']candidates["']\)/);
});

test("Student results keeps using the deployed trusted endpoints only", () => {
  assert.doesNotMatch(page, /\.from\("votes"\)/);
  assert.doesNotMatch(page, /\.from\("ballots"\)/);
  assert.doesNotMatch(page, /\.from\("vote_ballots"\)/);
  assert.doesNotMatch(page, /kandid_get_public_released_election_results/);
  assert.match(readFileSync("src/utils/resultDataLoader.js", "utf8"), /callVoteAccess\("election_results"/);
});

test("Board results stay on the established shared loader without the student state layer", () => {
  const boardPage = readFileSync("src/pages/board/Results.jsx", "utf8");
  assert.doesNotMatch(boardPage, /studentResults/);
  assert.match(boardPage, /fetchElectionResultDataset/);
});

test("Student result state surfaces are sharp, wrapped, and readable on narrow viewports", () => {
  assert.match(
    styles,
    /\.kandid-app-theme \.student-results-refresh \{[\s\S]*?border-radius: 0;/,
  );
  assert.match(
    styles,
    /\.kandid-app-theme \.student-results-state-title \{[\s\S]*?overflow-wrap: anywhere;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\) \{[\s\S]*?\.student-summary-rail > div \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/,
  );
  assert.match(
    styles,
    /\.student-summary-rail > div > h2 \{[\s\S]*?overflow-wrap: anywhere;/,
  );
  assert.match(styles, /\.student-elections-opening \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.student-elections-opening h1 \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(styles, /\.student-elections-trigger-copy strong \{[\s\S]*?white-space: normal;/);
  assert.match(
    styles,
    /@media \(max-width: 380px\) \{[\s\S]*?\.student-summary-rail \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
});

test("Student shell keeps bottom-navigation clearance and no fixed-width chart minimums on mobile", () => {
  assert.match(
    styles,
    /--kandid-mobile-bottom-clearance: calc\(5\.9rem \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\) \{[\s\S]*?\.election-results-chart\.is-editorial \.candidate-result-item \{\s*justify-self: stretch;\s*width: 100%;\s*max-width: 100%;\s*min-width: 0;/,
  );
});
