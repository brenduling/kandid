import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261018130000_password_protected_election_soft_removal.sql", "utf8");
const preflight = readFileSync("deploy/election-soft-removal-review/PREFLIGHT.sql", "utf8");
const postflight = readFileSync("deploy/election-soft-removal-review/POSTFLIGHT.sql", "utf8");

test("publication guard preserves UUID references and numeric election/position/candidate references", () => {
  assert.match(migration, /target_publication_id uuid;/);
  assert.match(migration, /target_publication_id := nullif\(row_data ->> 'publication_id', ''\)::uuid;/);
  assert.doesNotMatch(migration, /target_publication_id bigint|publication_id', ''\)::bigint/);
  for (const column of ["election_id", "position_id", "candidate_id"]) {
    assert.ok(migration.includes(`nullif(row_data ->> '${column}', '')::bigint`));
  }
  assert.match(migration, /p\.id = target_publication_id/);
  assert.match(migration, /for key share/);
});

test("installation and deployment checks fail closed on identifier-type drift", () => {
  for (const source of [migration, preflight, postflight]) {
    for (const tuple of [
      "('public.election_officer_publications','id','uuid')",
      "('public.election_officer_publication_entries','id','uuid')",
      "('public.election_officer_publication_entries','publication_id','uuid')",
      "('public.election_officer_publication_entries','source_officer_id','integer')",
      "('public.officer_leadership_releases','id','bigint')",
    ]) assert.ok(source.includes(tuple), tuple);
    assert.match(source, /a\.atttypid IS DISTINCT FROM pg_catalog\.to_regtype/);
    assert.match(source, /identifier types do not match/);
  }
  assert.match(postflight, /not the reviewed UUID-safe definition/);
});

test("UUID fix leaves immutable-history triggers and existing authorization untouched", () => {
  assert.doesNotMatch(migration, /DISABLE TRIGGER|session_replication_role|DROP POLICY|CREATE POLICY|GRANT.+ON.+TABLE/i);
  assert.doesNotMatch(migration, /DROP TRIGGER.*immutable|DROP FUNCTION.*reject_historical/i);
  assert.match(migration, /'public\.election_officer_publication_entries'/);
  assert.match(migration, /grant execute on function public\.kandid_soft_remove_election\(integer, uuid\) to service_role/i);
  assert.match(migration, /revoke all on function public\.kandid_soft_remove_election\(integer, uuid\) from public, anon, authenticated/i);
});
