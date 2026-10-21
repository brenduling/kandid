import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/proposals/anchor_ballot_hashes_cron_extensions.sql.disabled",
  "utf8",
);
const activation = readFileSync(
  "supabase/proposals/anchor_ballot_hashes_cron_activate.sql",
  "utf8",
);

test("Cron migration installs available extensions but leaves the worker unscheduled", () => {
  assert.equal(existsSync("supabase/migrations/20261021150000_anchor_ballot_hashes_cron.sql"), false);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net with schema extensions/i);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/i);
  assert.doesNotMatch(migration, /net\.http_post\s*\(/i);
});

test("approval-gated activation uses the five-minute schedule and Vault-only credentials", () => {
  assert.match(activation, /'\*\/5 \* \* \* \*'/);
  assert.match(activation, /vault\.decrypted_secrets/);
  assert.match(activation, /'kandid_anchor_gateway_jwt'/);
  assert.match(activation, /'Authorization',\s*'Bearer '\s*\|\|/);
  assert.match(activation, /'kandid_anchor_worker_token'/);
  assert.match(activation, /'x-anchor-worker-token'/);
  assert.match(activation, /'apikey'/);
  assert.doesNotMatch(activation, /Bearer\s+[A-Za-z0-9._-]{20,}/i);
  assert.doesNotMatch(activation, /service_role|private_key|DEPLOYER_PRIVATE_KEY/i);
});

test("activation checks Vault prerequisites and avoids overwriting a different named job", () => {
  assert.match(activation, /Required Anchor Cron Vault secrets are missing/);
  assert.match(activation, /select jobid into v_job_id[\s\S]*?from cron\.job/i);
  assert.match(activation, /schedule <> v_schedule or command <> v_command/i);
  assert.match(activation, /cron\.alter_job\(v_job_id, active := true\)/i);
  assert.match(activation, /cron\.schedule\([\s\S]*?'kandid-anchor-ballot-hashes'/i);
  assert.match(activation, /Existing job name is owned by a different schedule/);
});

test("prepared SQL does not alter ballots, vote rows, or election settings", () => {
  assert.doesNotMatch(`${migration}\n${activation}`, /\b(update|insert|delete)\s+(into\s+)?(public\.)?(vote_ballots|votes|elections)\b/i);
  assert.doesNotMatch(`${migration}\n${activation}`, /kandid_lock_board_electorate|mark_ballot_anchor_success/i);
});
