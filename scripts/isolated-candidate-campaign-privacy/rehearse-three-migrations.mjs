// Local synthetic rehearsal only. Never accepts a cloud URL, project ref or password.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { targets, packageFolder } from './prepare-three-migration-package.mjs';

const evidence = `${packageFolder}/evidence`;
mkdirSync(evidence, { recursive: true });
const catalog = JSON.parse(readFileSync('deploy/candidate-campaign-privacy-review/readiness/PRODUCTION_CATALOG.json', 'utf8'));
const fixtureFolder = 'scripts/isolated-candidate-campaign-privacy';
const container = `kandid-privacy-admin-rehearsal-${randomBytes(4).toString('hex')}`;
const database = 'kandid_privacy_storage_rehearsal';
const port = 59486;
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const password = randomBytes(24).toString('hex'); // Synthetic local credential only.
const dbUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}?sslmode=disable`;
const log = [];
const results = { environment: { container, database, image, host: '127.0.0.1', port,
  synthetic_only: true, production_connections: 0, persistent_volumes: 0 }, targets, checks: [] };
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
const apiSql = name => readFileSync(`${packageFolder}/${name}.sql`, 'utf8');
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
function securityFingerprint() {
  return JSON.parse(scalar(`SELECT jsonb_build_object(
    'policy',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='candidates'),
    'table_acl',(SELECT relacl::text FROM pg_class WHERE oid='public.candidates'::regclass),
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',p.proowner,'acl',p.proacl::text,'source',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY tgname) FROM pg_trigger t WHERE tgrelid='public.candidates'::regclass AND NOT tgisinternal)
  );`));
}
function negativePrerequisiteTests() {
  const cases = [
    ['extra_select', "CREATE POLICY unexpected_select ON public.candidates FOR SELECT TO authenticated USING(true);"],
    ['extra_all', "CREATE POLICY unexpected_all ON public.candidates FOR ALL TO authenticated USING(true) WITH CHECK(true);"],
    ['table_select', 'GRANT SELECT ON public.candidates TO authenticated;'],
    ['public_column', 'GRANT SELECT (bio) ON public.candidates TO PUBLIC;'],
    ['helper_drift', 'ALTER FUNCTION public.kandid_can_admin_read_candidate_v1(integer) SET search_path=public;'],
  ];
  for (const [name, change] of cases) {
    const badDb = `negative_${name}`;
    sql(`CREATE DATABASE ${badDb} TEMPLATE ${database};`);
    const cmd = ['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', badDb];
    docker(cmd, change);
    const beforeAcl = docker([...cmd, '-At'], "SELECT md5(coalesce(relacl::text,''))||':'||md5(string_agg(coalesce(attacl::text,''),',' ORDER BY attnum)) FROM pg_class JOIN pg_attribute ON attrelid=pg_class.oid WHERE pg_class.oid='public.candidates'::regclass GROUP BY relacl::text;").output;
    const failed = docker(cmd, readFileSync(targets[1].file), true);
    assert.notEqual(failed.status, 0, `Unsafe prerequisite accepted: ${name}`);
    const afterAcl = docker([...cmd, '-At'], "SELECT md5(coalesce(relacl::text,''))||':'||md5(string_agg(coalesce(attacl::text,''),',' ORDER BY attnum)) FROM pg_class JOIN pg_attribute ON attrelid=pg_class.oid WHERE pg_class.oid='public.candidates'::regclass GROUP BY relacl::text;").output;
    assert.equal(afterAcl, beforeAcl, `Failed migration changed grants: ${name}`);
    const recorded = docker([...cmd, '-At'], "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261018231601';").output.trim();
    assert.equal(recorded, '0');
    mark(`UNSAFE_PREREQUISITE_REJECTED_${name.toUpperCase()}`);
  }
}
function rollbackTest() {
  const rollbackDb = 'compatibility_rollback';
  sql(`CREATE DATABASE ${rollbackDb} TEMPLATE ${database};`);
  const cmd = ['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', rollbackDb];
  const readRows = query => JSON.parse(docker([...cmd, '-At'], query).output.trim());
  const preservation = readFileSync('deploy/candidate-campaign-privacy-review/PRESERVATION.sql', 'utf8').replace(/^\\set[^\r\n]*$/gm, '');
  const before = readRows(preservation);
  docker(cmd, readFileSync(`${packageFolder}/ROLLBACK.sql`));
  assert.deepEqual(readRows(preservation), before);
  assert.equal(docker([...cmd, '-At'], "SELECT count(*) FROM storage.buckets WHERE id='campaign-materials' AND NOT public;").output.trim(), '1');
  const rollbackUrl = dbUrl.replace(`/${database}?`, `/${rollbackDb}?`);
  run(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'migration', 'repair', targets[1].version,
    '--status', 'reverted', '--db-url', rollbackUrl]);
  const reverted = readRows("SELECT coalesce(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations;");
  assert.deepEqual(reverted, [...catalog.ledger.map(row => row.version), targets[0].version, targets[2].version].sort());
  mark('NARROW_ROLLBACK_AND_TARGET_ONLY_HISTORY_REVERSION');
}
await new Promise((accept, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(accept));
});
let created = false;
try {
  docker(['run', '-d', '--name', container, '--label', 'org.kandid.disposable=privacy-admin-three-targets',
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
  assert.equal(identity.Config.Labels['org.kandid.disposable'], 'privacy-admin-three-targets');
  assert.equal(identity.Mounts.length, 0, 'Unexpected persistent mount');
  assert.deepEqual(identity.HostConfig.PortBindings['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(port) }]);
  docker(['exec', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${database};`]);
  sql(readFileSync(`${fixtureFolder}/fixture.sql`));
  sql(readFileSync(`${packageFolder}/MUTATION_FIXTURE.sql`));
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
  results.environment.postgres_version = scalar("SHOW server_version;");
  assert.match(results.environment.postgres_version, /^17\.11\b/);
  sql(`UPDATE public.test_fixture_preservation_before SET snapshot='${JSON.stringify(before)}'::jsonb;`);
  sql(apiSql('PREFLIGHT'));
  mark('READ_ONLY_PREFLIGHT');
  const wrongOrder = docker(['exec', '-i', '-u', 'postgres', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database], apiSql('STORAGE_PREFLIGHT'), true);
  assert.notEqual(wrongOrder.status, 0);
  mark('STORAGE_FIRST_REJECTED_BY_RELEASE_PREFLIGHT');
  sql(readFileSync(targets[0].file));
  mark('PRIVACY_COMMIT');
  sql(apiSql('PRIVACY_POSTFLIGHT'));
  assert.deepEqual(fingerprint(), before);
  assert.deepEqual(ledger(), seededLedger);
  mark('PRIVACY_SECURITY_AND_23_GROUP_PRESERVATION');
  cli(['migration', 'repair', '20261018161039', '--status', 'applied']);
  verifyLedger(['20261018161039']);
  mark('PRIVACY_TARGET_ONLY_REPAIR_BELOW_EXISTING_MAX_VERSION');
  negativePrerequisiteTests();
  const beforeCompatibilitySecurity = securityFingerprint();
  sql(apiSql('COMPATIBILITY_PREFLIGHT'));
  sql(readFileSync(targets[1].file));
  mark('COMPATIBILITY_COMMIT');
  sql(apiSql('COMPATIBILITY_POSTFLIGHT'));
  assert.deepEqual(securityFingerprint(), beforeCompatibilitySecurity);
  assert.deepEqual(fingerprint(), before);
  mark('COMPATIBILITY_GRANTS_SECURITY_AND_PRESERVATION');
  sql(readFileSync(`${fixtureFolder}/admin_operations.sql`));
  assert.deepEqual(fingerprint(), before);
  mark('AUTHENTICATED_EDIT_DISCONNECT_CONCURRENCY_COUNTS_AND_DENIALS');
  cli(['migration', 'repair', targets[1].version, '--status', 'applied']);
  verifyLedger([targets[0].version, targets[1].version]);
  mark('COMPATIBILITY_TARGET_ONLY_RECORDING_AFTER_POSTFLIGHT');
  sql(apiSql('STORAGE_PREFLIGHT'));
  sql(readFileSync(targets[2].file));
  mark('STORAGE_COMMIT_AFTER_PRIVACY');
  sql(apiSql('STORAGE_POSTFLIGHT'));
  assert.deepEqual(fingerprint(), before);
  mark('STORAGE_SECURITY_AND_23_GROUP_PRESERVATION');
  cli(['migration', 'repair', '20261018150914', '--status', 'applied']);
  const afterLedger = verifyLedger(targets.map(target => target.version));
  results.installedLedger = afterLedger;
  sql(apiSql('LEDGER_POSTFLIGHT'));
  mark('EXACT_BASELINE_PLUS_THREE_LEDGER_ROWS');
  const list = cli(['migration', 'list']);
  const migrationList = JSON.parse(list.output.slice(list.output.indexOf('{'), list.output.lastIndexOf('}') + 1)).migrations;
  for (const { version } of targets) {
    assert.ok(migrationList.some(row => row.local === version && row.remote === version));
  }
  results.cliTargets = migrationList.filter(row => targets.some(target => target.version === row.local));
  mark('CLI_RECOGNIZES_ALL_THREE_TARGETS_AS_APPLIED');
  const push = cli(['db', 'push', '--dry-run', '--skip-vault'], true);
  assert.notEqual(push.status, 0);
  assert.match(push.output, /not found in local migrations|LegacyDbPushMissingLocal|Remote migration versions/i);
  results.normalDbPush = { status: 'BLOCKED_EXISTING_HISTORY_DRIFT',
    reason: 'Existing remote-only historical versions remain absent locally; none of the three installed targets is pending.',
    exit_code: push.status };
  mark('NORMAL_PUSH_FAILS_CLOSED_ON_PREEXISTING_HISTORY_DRIFT');
  sql(readFileSync(`${fixtureFolder}/assertions.sql`));
  sql(readFileSync(`${fixtureFolder}/storage_assertions.sql`));
  sql(readFileSync(`${fixtureFolder}/admin_operations.sql`));
  assert.deepEqual(fingerprint(), before);
  mark('CAMPAIGN_BALLOT_RESULTS_ADMIN_AND_STORAGE_RLS_ASSERTIONS');
  rollbackTest();
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
    assert.equal(label, 'privacy-admin-three-targets', 'Refusing cleanup of an unverified container');
    docker(['rm', '-f', container]); // Only this script's newly-created disposable container.
  }
  writeFileSync(`${evidence}/ISOLATED_REHEARSAL.json`, JSON.stringify(results, null, 2) + '\n');
  writeFileSync(`${evidence}/ISOLATED_REHEARSAL.log`, log.join('\n'));
}
