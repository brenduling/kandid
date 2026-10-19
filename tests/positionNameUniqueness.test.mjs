import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {positionSaveError} from '../src/utils/positionManagementContract.js';
const migration=readFileSync('supabase/migrations/20261018124015_position_name_per_election_unique.sql','utf8');
test('normalized position uniqueness covers all statuses and elections independently',()=>{
 assert.match(migration,/create unique index positions_election_normalized_name_unique\s+on public\.positions \(election_id, pg_catalog\.lower\(pg_catalog\.btrim\(name::text\)\)\)/);
 assert.doesNotMatch(migration,/create unique index[\s\S]*?where status/i);
 assert.match(migration,/having count\(\*\)>1/);assert.match(migration,/lock table public\.positions in share row exclusive mode/);
 assert.match(migration,/begin;[\s\S]*commit;/);assert.doesNotMatch(migration,/\b(?:insert into|delete from|update public\.|alter table|grant|revoke)\b/i);
});
test('database duplicate-name errors and order errors have distinct actionable messages',()=>{
 assert.equal(positionSaveError({code:'23505',message:'duplicate key value violates unique constraint "positions_election_normalized_name_unique"'}),'This position already exists in this election.');
 assert.match(positionSaveError({code:'23505',message:'positions_election_display_order_unique'}),/display order/);
});
