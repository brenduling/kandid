import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const forwardUrl = new URL("../supabase/proposals/system-settings-initial-record.sql", import.meta.url);
const rollbackUrl = new URL("../supabase/proposals/system-settings-initial-record.rollback.sql", import.meta.url);
const readSql = (url) => readFile(url, "utf8");

const approvedDefaults = {
  system_name: "KANDID Voting System",
  allow_multiple_votes: false,
  allow_abstain: true,
  default_election_duration: 2,
  maintenance_mode: false,
};

function applyProposalModel(state) {
  if (!state.schemaMatches || !state.rlsEnabled || state.forceRls) throw new Error("unexpected schema");
  if (!state.primaryKeyOnly || !state.expectedIndexOnly || state.userTriggerCount !== 0) throw new Error("unexpected dependencies");
  if (state.sequenceStart !== 1 || state.sequenceIncrement !== 1 || state.sequenceLastValue !== null) throw new Error("unexpected sequence");
  if (state.rows.length !== 0) throw new Error("existing record");

  return {
    ...state,
    sequenceLastValue: 1,
    rows: [{ id: 1, xmin: "810", created_at: "2026-10-22 12:00:00", ...approvedDefaults }],
  };
}

function rollbackProposalModel(state, fingerprint) {
  const match = state.rows.find((row) =>
    row.id === 1 &&
    row.xmin === fingerprint.xmin &&
    row.created_at === fingerprint.created_at &&
    Object.entries(approvedDefaults).every(([key, value]) => row[key] === value),
  );
  if (!match || state.foreignKeyCount !== 0 || state.userTriggerCount !== 0) throw new Error("rollback fingerprint mismatch");
  return { ...state, rows: state.rows.filter((row) => row !== match) };
}

const emptyBaseline = () => ({
  schemaMatches: true,
  rlsEnabled: true,
  forceRls: false,
  primaryKeyOnly: true,
  expectedIndexOnly: true,
  userTriggerCount: 0,
  foreignKeyCount: 0,
  sequenceStart: 1,
  sequenceIncrement: 1,
  sequenceLastValue: null,
  rows: [],
});

test("forward SQL guards the reviewed schema, RLS, primary key, trigger, and pristine id sequence", async () => {
  const sql = await readSql(forwardUrl);
  assert.match(sql, /LOCK TABLE public\.system_settings IN SHARE ROW EXCLUSIVE MODE/i);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /relrowsecurity IS TRUE/);
  assert.match(sql, /relforcerowsecurity IS FALSE/);
  assert.match(sql, /PRIMARY KEY \(id\)/);
  assert.match(sql, /system_settings_pkey/);
  assert.match(sql, /NOT tgisinternal/);
  assert.match(sql, /last_value IS NOT NULL/);
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.system_settings\)/i);
});

test("forward SQL inserts exactly one row from guarded defaults and changes no schema or policy", async () => {
  const sql = await readSql(forwardUrl);
  assert.equal([...sql.matchAll(/\bINSERT\s+INTO\s+public\.system_settings\b/gi)].length, 1);
  assert.match(sql, /VALUES \(DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT\)/);
  assert.match(sql, /RETURNING[\s\S]*?xmin::text AS rollback_xmin[\s\S]*?created_at/);
  assert.match(sql, /id = 1[\s\S]*?system_name = 'KANDID Voting System'[\s\S]*?allow_multiple_votes IS FALSE[\s\S]*?allow_abstain IS TRUE[\s\S]*?default_election_duration = 2[\s\S]*?maintenance_mode IS FALSE/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE\s+FROM)\s+public\.system_settings\b/i);
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+POLICY\b|\b(?:GRANT|REVOKE)\b/i);
});

test("proposal model inserts id 1 once with the expected values and refuses an existing record", () => {
  const before = emptyBaseline();
  const inserted = applyProposalModel(before);
  assert.equal(inserted.rows.length, 1);
  assert.equal(inserted.rows[0].id, 1);
  assert.deepEqual(Object.fromEntries(Object.keys(approvedDefaults).map((key) => [key, inserted.rows[0][key]])), approvedDefaults);
  assert.equal(before.rows.length, 0, "the baseline input is not mutated");
  assert.throws(() => applyProposalModel(inserted), /existing record|unexpected sequence/);
  assert.equal(inserted.rows.length, 1, "repeat execution does not duplicate or alter the row");
});

test("proposal model fails closed on changed schema, triggers, or sequence state", () => {
  for (const changed of [
    { schemaMatches: false },
    { rlsEnabled: false },
    { forceRls: true },
    { primaryKeyOnly: false },
    { expectedIndexOnly: false },
    { userTriggerCount: 1 },
    { sequenceStart: 2 },
    { sequenceLastValue: 1 },
  ]) {
    assert.throws(() => applyProposalModel({ ...emptyBaseline(), ...changed }));
  }
});

test("rollback requires the captured row fingerprint and leaves later changes untouched", async () => {
  const rollbackSql = await readSql(rollbackUrl);
  assert.match(rollbackSql, /REPLACE_WITH_RETURNED_ROLLBACK_XMIN/);
  assert.match(rollbackSql, /REPLACE_WITH_RETURNED_CREATED_AT/);
  assert.match(rollbackSql, /xmin::text = v_expected_xmin/);
  assert.match(rollbackSql, /created_at::text = v_expected_created_at/);
  assert.match(rollbackSql, /DELETE FROM public\.system_settings\s+WHERE id = 1[\s\S]*?xmin::text = v_expected_xmin[\s\S]*?created_at::text = v_expected_created_at/);
  assert.match(rollbackSql, /GET DIAGNOSTICS v_deleted = ROW_COUNT/);
  assert.match(rollbackSql, /unexpected foreign key/);

  const inserted = applyProposalModel(emptyBaseline());
  const fingerprint = { xmin: inserted.rows[0].xmin, created_at: inserted.rows[0].created_at };
  const changed = { ...inserted, rows: inserted.rows.map((row) => ({ ...row, xmin: "811", maintenance_mode: true })) };
  assert.throws(() => rollbackProposalModel(changed, fingerprint), /fingerprint mismatch/);
  assert.equal(changed.rows[0].maintenance_mode, true, "a later settings change remains untouched");

  const withLaterRow = { ...inserted, rows: [...inserted.rows, { id: 2, system_name: "Later record" }] };
  const rolledBack = rollbackProposalModel(withLaterRow, fingerprint);
  assert.deepEqual(rolledBack.rows, [{ id: 2, system_name: "Later record" }]);
});
