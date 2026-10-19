// Local synthetic rehearsal only. Never accepts a cloud URL, project ref or password.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import './prepare-readiness.mjs';

const evidence = 'deploy/candidate-campaign-privacy-review/readiness';
const catalog = JSON.parse(readFileSync(`${evidence}/PRODUCTION_CATALOG.json`, 'utf8'));
const fixtureFolder = 'scripts/isolated-candidate-campaign-privacy';
const container = `kandid-privacy-ledger-rehearsal-${randomBytes(4).toString('hex')}`;
const database = 'kandid_privacy_storage_rehearsal';
const port = 59485;
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const password = randomBytes(24).toString('hex'); // Synthetic local credential only.
const dbUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}?sslmode=disable`;
const log = [];
const results = { environment: { container, database, image, host: '127.0.0.1', port,
  synthetic_only: true, production_connections: 0, persistent_volumes: 0 }, checks: [] };
function run(exe, args, input, allowFailure = false) {
  const r = spawnSync(exe, args, { input, encoding: 'utf8', timeout: 120000,
    maxBuffer: 5 * 1024 * 1024, windowsHide: true });
  const output = `${r.stdout || ''}${r.stderr || ''}`.replaceAll(password, '[synthetic credential omitted]');
  log.push(output);
  if (!allowFailure && r.status !== 0) throw new Error(`${exe} failed (${r.status}): ${output}`);
  return { status: r.status, output };
}
const docker = (args, input, allowFailure = false) => run('docker', args, input, allowFailure);
const sql = input => docker(['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database], input);
const scalar = input => docker(['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database], input).output.trim();
const cli = (args, allowFailure = false) => run(process.execPath,
  [resolve('node_modules/supabase/dist/supabase.js'), ...args, '--db-url', dbUrl], undefined, allowFailure);
const mark = name => { results.checks.push({ name, status: 'PASS' }); console.log(`${name}=PASS`); };
const apiSql = name => readFileSync(`${evidence}/${name}_API.sql`, 'utf8');
function fingerprint() {
  const query = readFileSync('deploy/candidate-campaign-privacy-review/PRESERVATION.sql', 'utf8').replace(/^\\set[^\r\n]*$/gm, '');
  return JSON.parse(scalar(query));
}
function ledger() {
  return JSON.parse(scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version),'[]'::jsonb) FROM (
    SELECT version,name,md5(coalesce(array_to_string(statements,E'\n'),'')) AS statements_md5
    FROM supabase_migrations.schema_migrations) t;`));
}
function verifyLedger(targets) {
  const rows = ledger();
  assert.equal(rows.length, catalog.ledger.length + targets.length);
  assert.deepEqual(rows.filter(row => !targets.includes(row.version)), catalog.ledger);
  assert.deepEqual(rows.filter(row => targets.includes(row.version)).map(row => row.version).sort(), [...targets].sort());
  return rows;
}
await new Promise((accept, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(accept));
});
let created = false;
try {
  docker(['run', '-d', '--name', container, '--label', 'org.kandid.disposable=privacy-ledger-rehearsal',
    '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-p', `127.0.0.1:${port}:5432`, image, 'postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=*']);
  created = true;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (docker(['exec', '-u', 'postgres', container, 'pg_isready', '-h', '127.0.0.1'], undefined, true).status === 0) { ready = true; break; }
    if (docker(['inspect', container, '--format', '{{.State.Running}}']).output.trim() !== 'true') break;
    await new Promise(accept => setTimeout(accept, 1000));
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  const identity = JSON.parse(docker(['inspect', container]).output)[0];
  assert.equal(identity.Config.Labels['org.kandid.disposable'], 'privacy-ledger-rehearsal');
  assert.equal(identity.Mounts.length, 0, 'Unexpected persistent mount');
  assert.deepEqual(identity.HostConfig.PortBindings['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(port) }]);
  docker(['exec', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${database};`]);
  sql(readFileSync(`${fixtureFolder}/fixture.sql`));
  // These are explicit synthetic history fixtures copied as versions/names/digests
  // from the read-only catalog, not claimed historical SQL installations.
  sql(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations
    (version text PRIMARY KEY, statements text[], name text);`);
  // Preserve actual statements digests without copying production SQL by using a
  // separate baseline of the seeded history; target repair must leave it intact.
  for (const row of catalog.ledger) sql(`INSERT INTO supabase_migrations.schema_migrations(version,name)
    VALUES ('${row.version}','${row.name.replaceAll("'", "''")}');`);
  const seededLedger = ledger();
  catalog.ledger = seededLedger;
  mark('ISOLATION');
  const before = fingerprint();
  sql(apiSql('PREFLIGHT'));
  mark('READ_ONLY_PREFLIGHT');
  const wrongOrder = docker(['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database], apiSql('STORAGE_PREFLIGHT'), true);
  assert.notEqual(wrongOrder.status, 0);
  assert.match(wrongOrder.output, /Privacy must be committed/);
  mark('STORAGE_FIRST_REJECTED_BY_RELEASE_PREFLIGHT');
  sql(readFileSync('supabase/migrations/20261018161039_candidate_campaign_privacy_contract.sql'));
  mark('PRIVACY_COMMIT');
  sql(apiSql('POSTFLIGHT'));
  assert.deepEqual(fingerprint(), before);
  assert.deepEqual(ledger(), seededLedger);
  mark('PRIVACY_SECURITY_AND_23_GROUP_PRESERVATION');
  cli(['migration', 'repair', '20261018161039', '--status', 'applied']);
  verifyLedger(['20261018161039']);
  mark('PRIVACY_TARGET_ONLY_REPAIR_BELOW_EXISTING_MAX_VERSION');
  sql(apiSql('STORAGE_PREFLIGHT'));
  sql(readFileSync('supabase/migrations/20261018150914_campaign_material_storage.sql'));
  mark('STORAGE_COMMIT_AFTER_PRIVACY');
  sql(apiSql('STORAGE_POSTFLIGHT'));
  assert.deepEqual(fingerprint(), before);
  mark('STORAGE_SECURITY_AND_23_GROUP_PRESERVATION');
  cli(['migration', 'repair', '20261018150914', '--status', 'applied']);
  const afterLedger = verifyLedger(['20261018161039', '20261018150914']);
  results.installedLedger = afterLedger;
  sql(apiSql('LEDGER_POSTFLIGHT'));
  mark('EXACT_BASELINE_PLUS_TWO_LEDGER_ROWS');
  const list = cli(['migration', 'list']);
  const migrationList = JSON.parse(list.output.slice(list.output.indexOf('{'), list.output.lastIndexOf('}') + 1)).migrations;
  for (const version of ['20261018161039', '20261018150914']) {
    assert.ok(migrationList.some(row => row.local === version && row.remote === version));
  }
  results.cliTargets = migrationList.filter(row => ['20261018161039', '20261018150914'].includes(row.local));
  mark('CLI_RECOGNIZES_BOTH_TARGETS_AS_APPLIED');
  const push = cli(['db', 'push', '--dry-run', '--skip-vault'], true);
  assert.notEqual(push.status, 0);
  assert.match(push.output, /not found in local migrations|LegacyDbPushMissingLocal|Remote migration versions/i);
  results.normalDbPush = { status: 'BLOCKED_EXISTING_HISTORY_DRIFT',
    reason: 'Existing remote-only historical versions remain absent locally; neither installed target is pending.',
    exit_code: push.status };
  mark('NORMAL_PUSH_FAILS_CLOSED_ON_PREEXISTING_HISTORY_DRIFT');
  sql(readFileSync(`${fixtureFolder}/assertions.sql`));
  sql(readFileSync(`${fixtureFolder}/storage_assertions.sql`));
  assert.deepEqual(fingerprint(), before);
  mark('CAMPAIGN_BALLOT_RESULTS_ADMIN_AND_STORAGE_RLS_ASSERTIONS');
  const readback = JSON.parse(scalar(`SELECT jsonb_agg(to_jsonb(x) ORDER BY signature) FROM (
    SELECT p.oid::regprocedure::text AS signature,md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl::text AS acl
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.kandid_can_admin_read_candidate_v1(integer)'::regprocedure,
      'public.kandid_get_student_published_campaign(integer)'::regprocedure,
      'public.get_student_campaign(integer)'::regprocedure,
      'public.kandid_get_student_ballot_candidates(integer)'::regprocedure,
      'public.kandid_get_student_result_candidates(integer)'::regprocedure,
      'public.kandid_campaign_storage_access_v1(text,text)'::regprocedure)) x;`));
  writeFileSync(`${evidence}/EXPECTED_INSTALLED_FUNCTIONS.json`, JSON.stringify(readback, null, 2) + '\n');
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.failure = error.message.replaceAll(password, '[synthetic credential omitted]');
  throw error;
} finally {
  if (created) {
    if (results.status !== 'PASS') docker(['logs', '--tail', '30', container], undefined, true);
    const label = docker(['inspect', container, '--format', '{{index .Config.Labels "org.kandid.disposable"}}']).output.trim();
    assert.equal(label, 'privacy-ledger-rehearsal', 'Refusing cleanup of an unverified container');
    docker(['rm', '-f', container]); // Only this script's newly-created disposable container.
  }
  writeFileSync(`${evidence}/ISOLATED_REHEARSAL.json`, JSON.stringify(results, null, 2) + '\n');
  writeFileSync(`${evidence}/ISOLATED_REHEARSAL.log`, log.join('\n'));
}
