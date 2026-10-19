import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  countOperationalElections as countBoardActiveElections,
  getCampaignWindowPhase,
  getElectionPhase,
} from "../src/utils/electionLifecycle.js";
import {
  buildElectionPulse,
  countOperationalElections as countSuperAdminActiveElections,
} from "../src/utils/superAdminDashboard.js";

const election = {
  id: 42,
  status: "active",
  campaign_start: "2026-05-01T09:00:00",
  campaign_end: "2026-05-05T18:00:00",
  start_date: "2026-05-06T08:00:00",
  end_date: "2026-05-06T20:00:00",
};

const manilaInstant = (hour, minute = "00", day = "01") =>
  new Date(`2026-05-${day}T${hour}:${minute}:00+08:00`);

test("campaign window phase uses configured Manila schedule and half-open bounds", () => {
  const cases = [
    ["before start", manilaInstant("08", "59"), "upcoming"],
    ["at start", manilaInstant("09"), "ongoing"],
    ["during window", manilaInstant("12"), "ongoing"],
    ["at end", manilaInstant("18", "00", "05"), "ended"],
    ["after end", manilaInstant("19", "00", "05"), "ended"],
  ];
  for (const [label, now, expected] of cases) {
    assert.equal(getCampaignWindowPhase(election, now), expected, label);
  }
});

test("campaign phase fails closed for missing or invalid schedules and respects election lifecycle", () => {
  const now = manilaInstant("12");
  assert.equal(getCampaignWindowPhase({ ...election, campaign_start: null }, now), "not_scheduled");
  assert.equal(getCampaignWindowPhase({ ...election, campaign_end: "not-a-date" }, now), "not_scheduled");
  assert.equal(getCampaignWindowPhase({ ...election, campaign_start: election.campaign_end }, now), "not_scheduled");
  assert.equal(getCampaignWindowPhase({ ...election, campaign_start: "2026-05-06T18:00:00", campaign_end: "2026-05-06T09:00:00" }, now), "not_scheduled");
  assert.equal(getCampaignWindowPhase({ ...election, status: "closed", campaign_start: "2026-05-07T09:00:00" }, now), "ended");
  assert.equal(getCampaignWindowPhase({ ...election, status: "done" }, now), "ended");
  assert.equal(getCampaignWindowPhase({ ...election, status: "archived" }, now), "archived");
  assert.equal(getCampaignWindowPhase({ ...election, status: "draft" }, now), "not_available");
  assert.equal(getCampaignWindowPhase({ ...election, status: "scheduled" }, now), "not_available");
});

test("canonical lifecycle honors Manila schedule boundaries and half-open intervals", () => {
  const cases = [
    ["before campaign start", { ...election, campaign_start: "2026-05-01T09:00:00" }, manilaInstant("08", "59"), "campaign_upcoming"],
    ["exact campaign start", election, manilaInstant("09"), "campaign"],
    ["during campaign", election, manilaInstant("12", "30"), "campaign"],
    ["exact campaign end", election, manilaInstant("18", "00", "05"), "waiting"],
    ["campaign and voting gap", election, manilaInstant("22", "00", "05"), "waiting"],
    ["exact voting start", election, manilaInstant("08", "00", "06"), "voting"],
    ["during voting", election, manilaInstant("12", "00", "06"), "voting"],
    ["exact voting end", election, manilaInstant("20", "00", "06"), "closed"],
    ["after voting end", election, manilaInstant("20", "01", "06"), "closed"],
  ];

  for (const [label, record, now, expected] of cases) {
    assert.equal(getElectionPhase(record, now), expected, label);
  }
});

test("persisted lifecycle precedence keeps legacy done terminal without equating it to closed", () => {
  const inCampaign = manilaInstant("12", "00");
  assert.equal(getElectionPhase({ ...election, status: "closed" }, inCampaign), "closed");
  assert.equal(getElectionPhase({ ...election, status: "archived" }, inCampaign), "archived");
  assert.equal(getElectionPhase({ ...election, status: "draft" }, inCampaign), "draft");
  assert.equal(getElectionPhase({ ...election, status: "done" }, inCampaign), "done");
  assert.equal(getElectionPhase({ id: 9, status: "DONE" }, inCampaign), "done");
});

test("incomplete schedules preserve persisted status without inventing an operational phase", () => {
  assert.equal(getElectionPhase({ id: 7, status: "active", start_date: null, end_date: null }, manilaInstant("12")), "active");
  assert.equal(getElectionPhase({ id: 8, status: "draft" }, manilaInstant("12")), "draft");
});

test("release marker never changes lifecycle phase or distribution; archive keeps precedence", () => {
  const now = manilaInstant("20", "00", "06");
  const records = [
    { ...election, id: 1, results_released_at: null },
    { ...election, id: 2, results_released_at: "2026-05-06T12:00:00Z" },
    { ...election, id: 3, status: "archived", results_released_at: "2026-05-06T12:00:00Z" },
  ];
  const pulse = buildElectionPulse(records, now, getElectionPhase);
  assert.equal(getElectionPhase(records[0], now), "closed");
  assert.equal(getElectionPhase(records[1], now), "closed");
  assert.equal(pulse.find((item) => item.id === "closed").count, 2);
  assert.equal(pulse.find((item) => item.id === "archived").count, 1);
  assert.deepEqual(pulse.map(({ id, count }) => [id, count]), [
    ["draft", 0],
    ["upcoming", 0],
    ["campaigning", 0],
    ["voting", 0],
    ["closed", 2],
    ["archived", 1],
    ["other", 0],
  ]);
});

test("Board and Super Admin count exactly Campaigning plus Voting for one shared now", () => {
  const now = manilaInstant("12", "00", "06");
  const elections = [
    { ...election, id: 1 },
    { ...election, id: 2, campaign_start: "2026-05-06T09:00:00", campaign_end: "2026-05-06T18:00:00", start_date: "2026-05-07T08:00:00", end_date: "2026-05-07T20:00:00" },
    { ...election, id: 3, campaign_start: "2026-05-07T09:00:00", campaign_end: "2026-05-08T18:00:00", start_date: "2026-05-09T08:00:00", end_date: "2026-05-09T20:00:00" },
    { ...election, id: 4, status: "closed" },
  ];
  const boardCount = countBoardActiveElections(elections, now);
  const superAdminPhases = new Map();
  const pulse = buildElectionPulse(elections, now, (record, sharedNow) => {
    const phase = getElectionPhase(record, sharedNow);
    superAdminPhases.set(record.id, phase);
    return phase;
  });
  const superAdminCount = countSuperAdminActiveElections(pulse);
  const campaigning = elections.filter((record) => getElectionPhase(record, now) === "campaign").length;
  const voting = elections.filter((record) => getElectionPhase(record, now) === "voting").length;

  assert.equal(boardCount, campaigning + voting);
  assert.equal(superAdminCount, campaigning + voting);
  assert.equal(pulse.find((item) => item.id === "campaigning").count, campaigning);
  assert.equal(pulse.find((item) => item.id === "voting").count, voting);
  for (const record of elections) {
    assert.equal(getElectionPhase(record, now), superAdminPhases.get(record.id));
  }
});

test("Board and Super Admin screens share the centralized lifecycle clock", async () => {
  const root = new URL("../", import.meta.url);
  const boardFiles = [
    "src/pages/board/Dashboard.jsx",
    "src/pages/board/Elections.jsx",
    "src/pages/board/Positions.jsx",
    "src/pages/board/Results.jsx",
    "src/pages/superadmin/Dashboard.jsx",
    "src/pages/superadmin/Elections.jsx",
    "src/pages/superadmin/Positions.jsx",
    "src/pages/superadmin/Results.jsx",
    "src/components/CandidateManagement.jsx",
  ];
  for (const file of boardFiles) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.match(source, /useElectionClock\(\)/, `${file} consumes the shared clock`);
  }
});
