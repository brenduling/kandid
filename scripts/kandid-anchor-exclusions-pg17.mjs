// Disposable LOCAL PostgreSQL + the current worker with synthetic chain mocks.
// Never loads .env, production credentials, student identities, or vote choices.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { verifyLegacyVoteAnchorEvidence } from '../supabase/functions/_shared/legacyVoteAnchorEvidence.mjs';

const root = resolve(import.meta.dirname, '..');
const config = resolve(root, '.tmp/election-3-rule-validation/docker');
mkdirSync(config, { recursive: true });
const container = 'supabase_db_kandid-board-e2e-20261016-8c19';
const database = 'kandid_anchor_exclusions_' + randomBytes(6).toString('hex');
const prefix = ['--config', config, '--host', 'npipe:////./pipe/dockerDesktopLinuxEngine'];
const docker = (args, input) => spawnSync('docker', [...prefix, ...args], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const inspected = docker(['inspect', container]);
assert.equal(inspected.status, 0, inspected.stderr);
const info = JSON.parse(inspected.stdout)[0];
assert.equal(info.Name, '/' + container);
assert.equal(info.Config.Labels['com.supabase.cli.project'], 'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort, '59322');
assert.match(database, /^kandid_anchor_exclusions_[a-f0-9]{12}$/);
assert.equal(docker(['exec', container, 'createdb', '-U', 'postgres', '--template=template0', database]).status, 0);
const psql = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'];
const sql = (query, ok = true) => {
  const result = docker(psql, query);
  if (ok) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, 'Expected database rejection');
  return result;
};
const asyncSql = query => new Promise((done, reject) => {
  const child = spawn('docker', [...prefix, ...psql], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', status => done({ status, stdout, stderr }));
  child.stdin.end(query);
});
const last = result => result.stdout.trim().split('\n').at(-1);
const service = query => 'begin;set local role service_role;' + query + ';commit;';
const quote = value => value === null || value === undefined ? 'null' : typeof value === 'boolean' ? String(value) : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const hash = n => '0x' + createHash('sha256').update('synthetic ballot ' + n).digest('hex');
const uuid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const old = [
  { id: '3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1', election: 2, hash: '0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc', created: '2026-10-10T10:42:49.415608Z', submitted: '2026-10-10T10:42:49.426Z' },
  { id: 'a9bb5581-acb0-4c1b-9d7a-b08cf358368c', election: 4, hash: '0xf5074400475d07897d657d54903c2edeed6b3d618d472b71393624d50a4f9804', created: '2026-10-20T23:01:49.002167Z', submitted: '2026-10-20T23:01:49.005Z' },
];
const oldIds = old.map(b => quote(b.id)).join(',');
const fingerprint = () => last(sql(`select md5(jsonb_build_object('ballots',(select jsonb_agg(to_jsonb(b) order by id) from public.vote_ballots b where id in (${oldIds})),'votes',(select jsonb_agg(to_jsonb(v) order by id) from public.votes v where ballot_id in (${oldIds})))::text);`));
const contract = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/submitVoteIntegrityProductionContract.json'), 'utf8'));
// The inspected production definitions use LF inside dollar-quoted bodies.
const base = readFileSync(resolve(root, 'supabase/migrations/20260913160000_ballot_anchor_worker_rpcs.sql'), 'utf8').replaceAll('\r\n', '\n');
const proposal = readFileSync(resolve(root, 'supabase/proposals/anchor-exclude-two-existing-ballots.sql'), 'utf8');
const source = readFileSync(resolve(root, 'supabase/functions/anchor-ballot-hashes/index.ts'), 'utf8');
const workerManifest = JSON.parse(readFileSync(resolve(root, 'docs/anchor-auth-probe-manifest.json'), 'utf8'));
assert.equal(createHash('sha256').update(source).digest('hex'), workerManifest.worker.sha256);
const workerCode = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code.replace(/^import\s[\s\S]*?;\n/gm, '');
let checks = 0;
let baseline;
async function check(label, action) { await action(); checks++; if (baseline) assert.equal(fingerprint(), baseline, 'Excluded groups changed: ' + label); console.log('PASS ' + label); }

function seedBallot(id, election, student, ballotHash, created = '2026-10-21T05:00:00Z', submitted = '2026-10-21T05:00:00.000Z') {
  sql(`insert into public.vote_ballots(id,election_id,student_id,ballot_hash,hash_version,ballot_nonce,canonical_submitted_at,created_at,updated_at)
    values(${quote(id)},${election},${student},${quote(ballotHash)},'KANDID_BALLOT_V1',repeat('a',64),${quote(submitted)},${quote(created)},${quote(created)});
    insert into public.votes(student_id,election_id,position_id,candidate_id,is_abstain,vote_hash,hash_version,vote_nonce,canonical_vote_timestamp,blockchain_anchor_status,ballot_id)
    values(${student},${election},1,null,true,${quote(hash(student))},'KANDID_VOTE_V2',repeat('b',64),${quote(submitted)},'ballot_grouped',${quote(id)});`);
}

// Real SQL claim/mark/lease RPCs; no real provider, signer, HTTP, or wallet.
function worker() {
  const calls = [];
  const transactions = new Map();
  let fail = false;
  let handler;
  const registryAddress = '0x' + 'c'.repeat(40);
  const signerAddress = '0x' + 'd'.repeat(40);
  const blockHash = hash('block');
  const signatures = {
    claim_next_ballot_anchor: [], claim_next_submitted_ballot_anchor: [],
    acquire_ballot_anchor_signer_lease: ['p_owner_token','p_lease_seconds'], release_ballot_anchor_signer_lease: ['p_owner_token'],
    mark_ballot_anchor_submitted: ['p_ballot_id','p_ballot_hash','p_transaction_hash','p_network','p_contract_address'],
    mark_ballot_anchor_success: ['p_ballot_id','p_ballot_hash','p_transaction_hash','p_block_number','p_anchored_at'],
    mark_ballot_anchor_failure: ['p_ballot_id','p_ballot_hash','p_error','p_permanent'], mark_ballot_manual_review: ['p_ballot_id','p_ballot_hash','p_reason'],
  };
  const admin = { rpc: async (name, args = {}) => {
    assert.ok(Object.hasOwn(signatures, name));
    calls.push({ name, id: args.p_ballot_id });
    const invocation = `public.${name}(${signatures[name].map(key => quote(args[key])).join(',')})`;
    const query = name.startsWith('claim_') ? `select coalesce(jsonb_agg(to_jsonb(t)),'[]') from ${invocation} t` : `select to_jsonb(${invocation})`;
    const result = await asyncSql(service(query));
    if (result.status !== 0) return { data: null, error: { message: 'Synthetic database rejection' } };
    return { data: JSON.parse(last(result)), error: null };
  } };
  const receipt = (tx, ballotHash, failed) => ({ status: failed ? 0 : 1, blockNumber: 123, blockHash, hash: tx, to: registryAddress, logs: [{ address: registryAddress, name: 'VoteHashRecorded', args: { voteHash: ballotHash } }] });
  const provider = {
    getNetwork: async () => ({ chainId: 11155111n }), getBalance: async () => 10n ** 18n, getFeeData: async () => ({ gasPrice: 1n }),
    getTransactionReceipt: async tx => transactions.get(tx) ?? null,
    getBlock: async () => ({ number: 123, hash: blockHash, timestamp: 1792558800 }),
  };
  const record = async ballotHash => {
    calls.push({ name: 'synthetic_broadcast', hash: ballotHash });
    const tx = hash('transaction ' + calls.length);
    const result = receipt(tx, ballotHash, fail);
    transactions.set(tx, result);
    return { hash: tx, wait: async () => result };
  };
  record.estimateGas = async () => 100000n;
  const registry = { owner: async () => signerAddress, recordVoteHash: record, isVoteHashRecorded: async ballotHash => [...transactions.values()].some(r => r.status === 1 && r.logs[0].args.voteHash === ballotHash) };
  const ethers = {
    Interface: class { parseLog(log) { return { name: log.name, args: log.args }; } },
    JsonRpcProvider: class { constructor() { return provider; } },
    Wallet: class { async getAddress() { return signerAddress; } },
    Contract: class { constructor() { return registry; } },
  };
  const env = { ANCHOR_WORKER_TOKEN: 'synthetic-token', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key', SEPOLIA_RPC_URL: 'https://synthetic.invalid/rpc', DEPLOYER_PRIVATE_KEY: 'synthetic-not-a-key', VOTE_REGISTRY_ADDRESS: registryAddress };
  const bindings = { ethers, createClient: () => admin, verifyLegacyVoteAnchorEvidence, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } }, console: { log() {}, error() {}, warn() {} } };
  new Function(...Object.keys(bindings), workerCode)(...Object.values(bindings));
  return {
    calls, setFailed: value => { fail = value; },
    async run() {
      const response = await handler(new Request('https://synthetic.invalid/worker', { method: 'POST', headers: { 'x-anchor-worker-token': 'synthetic-token' } }));
      assert.equal(response.status, 200);
      return response.json();
    },
    submitted(ballotHash) { const tx = hash('preexisting synthetic transaction'); transactions.set(tx, receipt(tx, ballotHash, false)); return tx; },
  };
}

try {
  assert.equal(last(sql('select current_database();')), database);
  assert.match(last(sql('show server_version;')), /^17\./);
  sql(`create schema private;create schema extensions;create extension pgcrypto with schema extensions;
    create table public.students(id integer primary key);create table public.elections(id integer primary key);
    create table public.positions(id integer primary key);create table public.candidates(id integer primary key);
    create sequence public.votes_id_seq;
    insert into public.students select generate_series(1,30);insert into public.elections values(2),(4),(5);insert into public.positions values(1);`);
  for (const table of contract.tables) sql(`create table public.${table.table}(${table.columns.map(c => `"${c.name}" ${c.type}${c.default ? ' default ' + c.default : ''}${c.not_null ? ' not null' : ''}`).join(',')});`);
  for (const c of contract.constraints) sql(`alter table public.${c.table} add constraint "${c.name}" ${c.definition};`);
  sql(base);
  // Production-shaped RLS and timestamp trigger; no browser or service direct writes.
  sql(`alter table public.vote_ballots enable row level security;alter table public.votes enable row level security;
    revoke all on public.vote_ballots,public.votes from public,anon,authenticated,service_role;
    grant select on public.vote_ballots,public.votes to service_role;
    create function public.set_vote_ballots_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end;$$;
    create trigger vote_ballots_set_updated_at before update on public.vote_ballots for each row execute function public.set_vote_ballots_updated_at();`);
  for (const [i, b] of old.entries()) seedBallot(b.id, b.election, i + 1, b.hash, b.created, b.submitted);
  baseline = fingerprint();

  await check('incorrect immutable binding rolls the entire proposal back', () => {
    assert.match(sql(proposal.replaceAll(old[0].hash, hash('wrong')), false).stderr, /do not match/);
    assert.equal(last(sql("select to_regclass('private.ballot_anchor_exclusions') is null;")), 't');
  });
  await check('claim contract drift prevents installation before any control rows are written', () => {
    const definition = JSON.parse(last(sql("select to_jsonb(pg_get_functiondef('public.claim_next_ballot_anchor()'::regprocedure));")));
    sql(definition.replace('begin\n', 'begin\n  -- synthetic contract drift\n'));
    assert.match(sql(proposal, false).stderr, /claim contract changed/);
    assert.equal(last(sql("select to_regclass('private.ballot_anchor_exclusions') is null;")), 't');
    sql(base);
  });
  await check('nonquiescent signer lease prevents installation', () => {
    sql("select public.acquire_ballot_anchor_signer_lease('synthetic-install-blocker',120);");
    assert.match(sql(proposal, false).stderr, /not quiescent/);
    sql("select public.release_ballot_anchor_signer_lease('synthetic-install-blocker');");
  });
  await check('reviewed proposal applies atomically without touching either group', () => {
    sql(proposal);
    assert.equal(last(sql('select count(*) from private.ballot_anchor_exclusions;')), '2');
    sql(readFileSync(resolve(root, 'supabase/runtime-validation/anchor-exclusions-readonly.sql'), 'utf8'));
  });
  await check('reinstallation fails safely without changing exclusions or ballots', () => {
    assert.match(sql(proposal, false).stderr, /already exist/);
  });
  await check('browser roles cannot claim work and service cannot change private exclusions', () => {
    for (const role of ['anon','authenticated']) for (const name of ['claim_next_ballot_anchor','claim_next_submitted_ballot_anchor']) assert.match(sql(`set role ${role};select * from public.${name}();`, false).stderr, /permission denied/);
    for (const role of ['anon','authenticated','service_role']) assert.match(sql(`set role ${role};delete from private.ballot_anchor_exclusions;`, false).stderr, /permission denied/);
    for (const query of ['update private.ballot_anchor_exclusions set reason=reason','delete from private.ballot_anchor_exclusions','truncate private.ballot_anchor_exclusions']) assert.match(sql(query, false).stderr, /immutable/);
  });
  await check('excluded groups cannot be mutated, detached, extended, claimed or manually marked', () => {
    for (const b of old) {
      for (const query of [
        `update public.vote_ballots set blockchain_anchor_status='anchoring' where id=${quote(b.id)}`,
        `update public.vote_ballots set ballot_hash=${quote(hash('tampered'))} where id=${quote(b.id)}`,
        `delete from public.vote_ballots where id=${quote(b.id)}`,
        `update public.votes set ballot_id=null where ballot_id=${quote(b.id)}`,
        `delete from public.votes where ballot_id=${quote(b.id)}`,
        `insert into public.votes(student_id,election_id,position_id,is_abstain,hash_version,blockchain_anchor_status,ballot_id) values(30,${b.election},1,true,'legacy_v1','legacy_unanchored',${quote(b.id)})`,
        service(`select public.mark_ballot_manual_review(${quote(b.id)},${quote(b.hash)},'synthetic')`),
      ]) assert.match(sql(query, false).stderr, /excluded from automatic anchoring/);
    }
    for (const name of ['claim_next_ballot_anchor','claim_next_submitted_ballot_anchor']) assert.equal(last(sql(service(`select count(*) from public.${name}()`))), '0');
  });
  await check('retry, stale-claim and submitted-reconciliation selectors all exclude both UUIDs', () => {
    // Test-only hypothetical states; transaction rollback preserves the fixture.
    for (const status of ['anchor_failed','anchoring','submitted']) {
      const result = sql(`begin;alter table public.vote_ballots disable trigger kandid_preserve_excluded_ballot;
        update public.vote_ballots set blockchain_anchor_status=${quote(status)},blockchain_tx_id=${quote(hash('old hypothetical tx'))},blockchain_anchor_claimed_at=now()-interval '20 minutes' where id in (${oldIds});
        alter table public.vote_ballots enable trigger kandid_preserve_excluded_ballot;set local role service_role;
        select (select count(*) from public.claim_next_ballot_anchor())+(select count(*) from public.claim_next_submitted_ballot_anchor());rollback;`);
      assert.equal(last(result), '0');
    }
  });
  await check('stale submitted, success and failure RPC calls cannot mutate an excluded group', () => {
    for (const b of old) for (const [status, invocation] of [
      ['anchoring', `mark_ballot_anchor_submitted(${quote(b.id)},${quote(b.hash)},${quote(hash('hypothetical'))},'sepolia',${quote('0x'+'c'.repeat(40))})`],
      ['submitted', `mark_ballot_anchor_success(${quote(b.id)},${quote(b.hash)},${quote(hash('hypothetical'))},123,now())`],
      ['submitted', `mark_ballot_anchor_failure(${quote(b.id)},${quote(b.hash)},'synthetic failure',false)`],
    ]) {
      // Hypothetical states exist only inside a failing, rolled-back LOCAL transaction.
      const query = `begin;alter table public.vote_ballots disable trigger kandid_preserve_excluded_ballot;
        update public.vote_ballots set blockchain_anchor_status=${quote(status)},blockchain_tx_id=${quote(hash('hypothetical'))},blockchain_network='sepolia',blockchain_contract_address=${quote('0x'+'c'.repeat(40))} where id=${quote(b.id)};
        alter table public.vote_ballots enable trigger kandid_preserve_excluded_ballot;set local role service_role;
        select public.${invocation};commit;`;
      assert.match(sql(query, false).stderr, /excluded from automatic anchoring/);
    }
  });
  const h = worker();
  await check('repeated unchanged-worker runs leave old groups pending and broadcast nothing', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await h.run()).processed, 0);
    assert.equal(h.calls.filter(c => c.name === 'synthetic_broadcast').length, 0);
  });
  await check('new ballot in the same Election 4 anchors normally; repeated run is idle', async () => {
    seedBallot(uuid(3),4,3,hash(3));
    assert.equal((await h.run()).anchored, 1);
    assert.equal(last(sql(`select blockchain_anchor_status from public.vote_ballots where id=${quote(uuid(3))};`)), 'anchored');
    assert.equal((await h.run()).processed, 0);
    assert.equal(h.calls.filter(c => c.name === 'synthetic_broadcast').length, 1);
  });
  await check('new-ballot failure retains existing 1/5/15-minute backoff then manual review', async () => {
    seedBallot(uuid(4),2,4,hash(4));h.setFailed(true);
    for (const [i, minutes] of [[1,1],[2,5],[3,15],[4,null]]) {
      if (i > 1) sql(`update public.vote_ballots set blockchain_next_retry_at=now()-interval '1 second' where id=${quote(uuid(4))};`);
      await h.run();
      const row = JSON.parse(last(sql(`select jsonb_build_object('count',blockchain_retry_count,'status',blockchain_anchor_status,'delay',extract(epoch from (blockchain_next_retry_at-clock_timestamp())),'retry_null',blockchain_next_retry_at is null) from public.vote_ballots where id=${quote(uuid(4))};`)));
      assert.equal(row.count, i);
      assert.equal(row.status, minutes ? 'anchor_failed' : 'manual_review');
      if (minutes) assert.ok(row.delay > minutes*60-30 && row.delay <= minutes*60);
      else assert.equal(row.retry_null, true);
      const broadcasts = h.calls.filter(c => c.name === 'synthetic_broadcast').length;
      assert.equal((await h.run()).processed, 0);
      assert.equal(h.calls.filter(c => c.name === 'synthetic_broadcast').length, broadcasts);
    }
    h.setFailed(false);
  });
  await check('new submitted ballot reconciles verified evidence without rebroadcast', async () => {
    seedBallot(uuid(5),4,5,hash(5));
    const tx = h.submitted(hash(5));
    sql(`update public.vote_ballots set blockchain_anchor_status='submitted',blockchain_tx_id=${quote(tx)},blockchain_network='sepolia',blockchain_contract_address=${quote('0x'+'c'.repeat(40))} where id=${quote(uuid(5))};`);
    const count = h.calls.filter(c => c.name === 'synthetic_broadcast').length;
    assert.equal((await h.run()).anchored, 1);
    assert.equal(h.calls.filter(c => c.name === 'synthetic_broadcast').length, count);
  });
  await check('overlapping claims skip locked rows and never return an excluded group', async () => {
    seedBallot(uuid(6),2,6,hash(6));seedBallot(uuid(7),4,7,hash(7));
    const query = service("select ballot_id from public.claim_next_ballot_anchor();select pg_sleep(0.5)");
    const results = await Promise.all([asyncSql(query),asyncSql(query)]);
    for (const r of results) assert.equal(r.status, 0, r.stderr);
    const ids = results.map(r => r.stdout.trim().split('\n').find(line => /^[0-9a-f-]{36}$/.test(line)));
    assert.deepEqual(new Set(ids), new Set([uuid(6),uuid(7)]));
    for (const id of ids) sql(service(`select public.mark_ballot_manual_review(${quote(id)},${quote(id===uuid(6)?hash(6):hash(7))},'synthetic concurrency complete')`));
  });
  await check('signer contention leaves a newer ballot unclaimed until the existing lease is released', async () => {
    seedBallot(uuid(8),4,8,hash(8));
    sql(service("select public.acquire_ballot_anchor_signer_lease('synthetic-busy',120)"));
    assert.equal((await h.run()).results[0].status, 'signer_busy');
    assert.equal(last(sql(`select blockchain_anchor_status from public.vote_ballots where id=${quote(uuid(8))};`)), 'pending');
    sql(service("select public.release_ballot_anchor_signer_lease('synthetic-busy')"));
    assert.equal((await h.run()).anchored, 1);
  });
  console.log(`${checks} local PostgreSQL/worker checks passed. No production connection or real chain provider was used.`);
} finally {
  assert.match(database, /^kandid_anchor_exclusions_[a-f0-9]{12}$/);
  const result = docker(['exec',container,'dropdb','-U','postgres','--force',database]);
  assert.equal(result.status, 0, result.stderr);
}
