// Read-only production evidence collector. Contains no deployment or repair path.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import './prepare-readiness.mjs';

const project = 'fszgdxqxonqqcrzsnkca';
const evidence = 'deploy/candidate-campaign-privacy-review/readiness';
assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), project);
function query(file) {
  const result = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'),
    'db', 'query', '--linked', '--project-ref', project, '--file', file, '--output', 'json'],
  { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Read-only CLI query failed: ${result.stderr || result.error || result.stdout}`);
  const output = result.stdout;
  return JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)).rows;
}
const preflightRows = query(`${evidence}/PREFLIGHT_API.sql`);
const snapshot = preflightRows.find(row => row.read_only_23_group_snapshot)?.read_only_23_group_snapshot;
assert.ok(snapshot, 'No preservation snapshot returned');
const expected = JSON.parse(readFileSync('deploy/candidate-campaign-privacy-review/EXPECTED_PRESERVATION.json', 'utf8')).groups;
const comparisons = Object.keys(expected).map(group => ({ group,
  match: expected[group].rows === snapshot[group]?.rows && expected[group].md5 === snapshot[group]?.md5 }));
writeFileSync(`${evidence}/PRODUCTION_PREFLIGHT.json`, JSON.stringify({ project,
  checked_at_utc: new Date().toISOString(), read_only: true, preflight_passed: true,
  groups: snapshot, comparisons }, null, 2) + '\n');
assert.ok(comparisons.every(row => row.match), `Preservation baseline drift: ${comparisons.filter(row => !row.match).map(row => row.group).join(', ')}`);
const catalogSql = `BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY version) FROM (
    SELECT version,name,md5(coalesce(array_to_string(statements,E'\\n'),'')) AS statements_md5
    FROM supabase_migrations.schema_migrations) x),
  'storage_policies',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
    SELECT policyname,roles,cmd,qual,with_check FROM pg_catalog.pg_policies
    WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname) x),
  'protected_functions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY signature) FROM (
    SELECT p.oid::regprocedure::text AS signature,md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl::text AS acl
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind='f') x),
  'target_bucket_present',EXISTS(SELECT 1 FROM storage.buckets WHERE id='campaign-materials'),
  'postgres_version',current_setting('server_version')
) AS catalog;
COMMIT;`;
writeFileSync(`${evidence}/CATALOG_API.sql`, catalogSql);
const catalog = query(`${evidence}/CATALOG_API.sql`)[0].catalog;
assert.equal(catalog.target_bucket_present, false);
writeFileSync(`${evidence}/PRODUCTION_CATALOG.json`, JSON.stringify({ project,
  checked_at_utc: new Date().toISOString(), read_only: true, ...catalog }, null, 2) + '\n');
console.log(`PRODUCTION_PREFLIGHT=PASS; PRESERVATION=${comparisons.length}/${comparisons.length}; LEDGER_VERSIONS=${catalog.ledger.length}`);
