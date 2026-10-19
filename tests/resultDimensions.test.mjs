import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { yearLevelLabel } from "../src/utils/results.js";

const source = readFileSync("src/utils/resultDimensions.js", "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");
const election = { id: 7, organization_id: 2 };

function harness() {
  const reads = [];
  const fixtures = {
    organization_programs: [{ programs: { id: 1, code: "BSIT", name: "Information Technology" } }],
    eligibility_rules: [{ program: "BSIT", min_year_level: 1, max_year_level: 2, allow_shs: false }],
  };
  const fetchResultDimensions = runInNewContext(`${source}\nfetchResultDimensions`, {
    yearLevelLabel,
    normalizeProgram: (value) => String(value || "").trim().toUpperCase(),
    selectActiveMemberships: () => assert.fail("Results must not read private membership demographics"),
    console: { warn: () => assert.fail("No optional lookup warnings are expected") },
    supabase: {
      from(table) {
        assert.ok(Object.hasOwn(fixtures, table), `Unexpected table read: ${table}`);
        return {
          select(columns) {
            return {
              eq(column, value) {
                reads.push({ table, columns, column, value });
                return Promise.resolve({ data: fixtures[table], error: null });
              },
            };
          },
        };
      },
    },
  });
  return { reads, fetchResultDimensions };
}

test("default Board/Super Admin dimensions use scoped configuration without membership or candidate reads", async () => {
  const h = harness();
  const result = await h.fetchResultDimensions(election);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    programs: [{ code: "BSIT", label: "BSIT", name: "Information Technology" }],
    yearLevels: ["1st Year", "2nd Year"],
  });
  assert.deepEqual(h.reads.map(({ table, column, value }) => ({ table, column, value })), [
    { table: "organization_programs", column: "organization_id", value: 2 },
    { table: "eligibility_rules", column: "election_id", value: 7 },
  ]);
});

test("Student dimensions continue to skip membership demographics", async () => {
  const h = harness();
  const result = await h.fetchResultDimensions(election, { includeMembershipDemographics: false });
  assert.equal(result.programs.length, 1);
  assert.equal(h.reads.length, 2);
});

test("missing election context produces no dimension requests", async () => {
  const h = harness();
  assert.equal((await h.fetchResultDimensions(null)).programs.length, 0);
  assert.equal(h.reads.length, 0);
});
