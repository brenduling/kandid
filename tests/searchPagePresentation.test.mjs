import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/pages/shared/SearchPage.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/pages/shared/SearchPage.css", import.meta.url), "utf8");
const search = await readFile(new URL("../src/utils/globalSearch.js", import.meta.url), "utf8");

test("Search Results keeps its existing role-filtered category sets", () => {
  assert.match(search, /student:\s*\["programs", "organizations", "students", "elections", "candidates", "officers", "results"\]/);
  assert.match(search, /electoral_board:\s*\[\s*"programs",\s*"students",\s*"elections",\s*"candidates",\s*"positions",\s*"officers",\s*"partylists",\s*"results",\s*"reports"/);
  assert.match(search, /super_admin:\s*\[\s*"programs",\s*"organizations",\s*"students",\s*"elections",\s*"candidates",\s*"positions",\s*"officers",\s*"partylists",\s*"results",\s*"reports",\s*"audit_logs"/);
  assert.match(search, /requestedCategories\s*\?\s*requestedCategories\.filter\(\(category\) => allowedCategories\.includes\(category\)\)\s*:\s*allowedCategories/);
  assert.match(search, /if \(role === "student"\) return \[\]/);
  assert.match(search, /if \(role !== "super_admin"\) return \[\]/);
  assert.match(page, /getRoleSearchCategories\(activeUser\?\.role\)/);
});

test("Search presentation retains URL query, category, year, and selected-result state", () => {
  for (const parameter of ['get("q")', 'get("type")', 'get("id")', 'get("year")']) {
    assert.ok(page.includes(parameter), `Search page should retain ${parameter}`);
  }
  assert.match(page, /searchKandid\(activeUser, query, \{ perCategoryLimit: 24, year \}\)/);
  assert.match(page, /params\.set\("id", result\.id\)/);
  assert.match(page, /findSearchResult\(searchData/);
});

test("short queries, genuine empty searches, loading, errors, and partial results remain distinct", () => {
  assert.match(page, /query\.length < SEARCH_MIN_LENGTH/);
  assert.match(page, /Keep typing/);
  assert.match(page, /Enter at least 2 characters to search Kandid\./);
  assert.match(page, /Searching Kandid/);
  assert.match(page, /Search unavailable/);
  assert.match(page, /displayedGroups\.length === 0/);
  assert.match(page, /Nothing matched/);
  assert.match(page, /Some result categories could not be loaded\./);
  assert.match(page, /Kandid could not search every result category\./);
  assert.match(page, /activeType === "all" \? displayedGroups\.length === 0 : failedCategories\.has\(activeType\)/);
  assert.match(page, /setRetryCount\(\(current\) => current \+ 1\)/);
  assert.match(page, /searchData && !loading/);
});

test("result index and selected safe details use a flat responsive hierarchy", () => {
  assert.match(page, /kandid-search-result-type/);
  assert.match(page, /kandid-search-result-copy/);
  assert.match(page, /aria-pressed=\{selected\}/);
  assert.match(page, /result\.sections/);
  assert.match(page, /result\.related/);
  assert.doesNotMatch(page, /Smart Search|search-result-badges|search-state-card|search-loading-card/);
  assert.match(styles, /border-left: 1px solid var\(--search-rule-strong\)/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /:focus-visible/);
});
