import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/pages/board/ElectionElectoratePanel.jsx", "utf8");
const setup = readFileSync("src/pages/board/BoardElectionSetup.jsx", "utf8");
const elections = readFileSync("src/pages/board/Elections.jsx", "utf8");
const css = readFileSync("src/pages/board/Elections.css", "utf8");

test("Board distinguishes scheduled finalization, failure, completion and optional eligibility", () => {
  for (const value of ["Activation schedules the electorate freeze automatically", "membership_only",
    "membership_plus_rules", "Retry finalization", "scheduled_finalization_at", "next_attempt_at"]) {
    assert.ok(panel.includes(value), `missing Board readiness detail: ${value}`);
  }
  assert.match(setup, /schedules electorate\s+finalization automatically for ten minutes before voting starts/i);
});

test("Board readiness panel keeps its two-column small-screen layout and full-width actions", () => {
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?board-election-electorate-facts\s*\{\s*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /board-election-electorate-actions button\s*\{\s*width:\s*100%/);
});

test("Board checks scheduler readiness before the election write", () => {
  const readiness = elections.indexOf("await assertElectorateSchedulingReady(supabase, editing, payload)");
  const write = elections.indexOf("let result = await saveElection(payload)");
  assert.ok(readiness >= 0 && readiness < write);
  assert.match(elections, /Automatic electorate finalization is not ready\. The election was not saved\./);
});
