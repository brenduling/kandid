import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import test from 'node:test';

const workflowPath = '.github/workflows/anchor-ballot-hashes.yml';
const proposalPath = '.github/workflow-proposals/anchor-ballot-hashes.yml';
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n');
function extractRunBlock(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const runLineIndex = lines.findIndex(line => /^[ \t]*run:[ \t]*\|[ \t]*$/.test(line));
  assert.notEqual(runLineIndex, -1, 'workflow must contain a literal run block');

  const runIndent = lines[runLineIndex].match(/^[ \t]*/)[0].length;
  let contentIndent;
  const block = [];
  for (const line of lines.slice(runLineIndex + 1)) {
    if (/^[ \t]*$/.test(line)) {
      block.push('');
      continue;
    }
    const indent = line.match(/^[ \t]*/)[0].length;
    if (indent <= runIndent) break;
    if (contentIndent === undefined) contentIndent = indent;
    assert.ok(indent >= contentIndent, 'run block indentation must be consistent');
    block.push(line.slice(contentIndent));
  }
  assert.ok(block.some(line => line.trim()), 'workflow run block must not be empty');
  return block.join('\n').replace(/\n+$/, '');
}
const script = extractRunBlock(workflow);
const conditionMatch = workflow.match(/^[ \t]*if:[ \t]*>-\s*\n([\s\S]*?)^[ \t]*runs-on:/m);
assert.ok(conditionMatch, 'workflow must contain the guarded anchor job condition');
const condition = conditionMatch[1].trim();
const permitted = new Function('github', 'vars', 'inputs', `return (${condition});`);
const project = 'fszgdxqxonqqcrzsnkca';
const token = 'synthetic-private-worker-token';
function jwt(claims = {}, header = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', ...header })}.${encode({ role: 'anon', ref: project, exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.synthetic-signature`;
}
async function run({ env = {}, status = 200, body = { ok: true, status: 'idle', processed: 0 }, failure, invalidJson = false } = {}) {
  const calls = [], logs = [];
  const process = { env: { KANDID_ANCHOR_GATEWAY_JWT: jwt(), KANDID_ANCHOR_WORKER_TOKEN: token, ...env } };
  const context = {
    process, Buffer, AbortSignal,
    console: Object.fromEntries(['log', 'error'].map(method => [method, value => logs.push(String(value))])),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failure) throw new Error(`${failure} ${token}`);
      return { status, json: async () => {
        if (invalidJson) throw new Error(token);
        return body;
      } };
    },
  };
  await new Script(script).runInNewContext(context);
  assert.ok(logs.every(line => !line.includes(token) && !line.includes(process.env.KANDID_ANCHOR_GATEWAY_JWT || 'UNUSED')));
  return { calls, logs, exitCode: process.exitCode };
}

test('prepared workflow matches the inert proposal and uses no GitHub write token or third party actions', () => {
  assert.equal(existsSync(workflowPath), true);
  const normalize = value => value.replace(/\r\n?/g, '\n').replace(/^(?:#.*\n)+/m, '');
  assert.equal(normalize(workflow), normalize(readFileSync(proposalPath, 'utf8')));
  assert.match(workflow, /cron: '2-59\/5 \* \* \* \*'/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /group: kandid-anchor-ballot-hashes-production\n  cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.doesNotMatch(workflow, /\buses:|pull_request|^  push:/m);
  assert.equal((workflow.match(/\$\{\{ secrets\./g) || []).length, 2);
});

test('run block extraction accepts CRLF and different YAML indentation', () => {
  const formattedWorkflow = [
    'jobs:',
    '  anchor:',
    '    steps:',
    '      - name: invoke',
    '        run: |',
    '          first();',
    '          second();',
    '      - name: next',
    '        run: echo ignored',
  ].join('\r\n');
  assert.equal(extractRunBlock(formattedWorkflow), 'first();\nsecond();');
});

test('disabled, non-main, fork, and unconfirmed manual events cannot reach the invocation job', () => {
  const github = { repository: 'brenduling/kandid', ref: 'refs/heads/main', event_name: 'schedule' };
  assert.equal(permitted(github, {}, {}), false);
  assert.equal(permitted(github, { KANDID_ANCHOR_SCHEDULER_ENABLED: 'false' }, {}), false);
  const enabled = { KANDID_ANCHOR_SCHEDULER_ENABLED: 'true' };
  assert.equal(permitted(github, enabled, {}), true);
  assert.equal(permitted({ ...github, repository: 'fork/kandid' }, enabled, {}), false);
  assert.equal(permitted({ ...github, ref: 'refs/heads/other' }, enabled, {}), false);
  assert.equal(permitted({ ...github, event_name: 'push' }, enabled, {}), false);
  const manual = { ...github, event_name: 'workflow_dispatch' };
  assert.equal(permitted(manual, enabled, {}), false);
  assert.equal(permitted(manual, enabled, { confirm_anchor_pending_ballots: false }), false);
  assert.equal(permitted(manual, enabled, { confirm_anchor_pending_ballots: true }), true);
});

test('request uses only the official HTTPS worker URL with gateway JWT and separate worker token', async () => {
  const result = await run();
  assert.equal(result.exitCode, undefined);
  assert.equal(result.calls.length, 1);
  const { url, options } = result.calls[0];
  assert.equal(url, `https://${project}.supabase.co/functions/v1/anchor-ballot-hashes`);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer ' + options.headers.apikey);
  assert.equal(options.headers['x-anchor-worker-token'], token);
  assert.deepEqual(JSON.parse(options.body), { source: 'github-actions' });
  assert.ok(options.signal instanceof AbortSignal);
});

test('missing tokens, publishable bearer values, privileged, expired, and wrong-project JWTs fail before HTTP', async () => {
  for (const env of [
    { KANDID_ANCHOR_WORKER_TOKEN: '' },
    { KANDID_ANCHOR_WORKER_TOKEN: 'invalid\nheader' },
    { KANDID_ANCHOR_GATEWAY_JWT: '' },
    { KANDID_ANCHOR_GATEWAY_JWT: 'sb_publishable_synthetic' },
    { KANDID_ANCHOR_GATEWAY_JWT: jwt({ role: 'service_role' }) },
    { KANDID_ANCHOR_GATEWAY_JWT: jwt({ role: 'authenticated' }) },
    { KANDID_ANCHOR_GATEWAY_JWT: jwt({ ref: 'wrong' }) },
    { KANDID_ANCHOR_GATEWAY_JWT: jwt({ exp: 1 }) },
    { KANDID_ANCHOR_GATEWAY_JWT: jwt({}, { alg: 'none' }) },
  ]) {
    const result = await run({ env });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 0);
  }
});

test('gateway rejection, worker rejection, missing deployment and server errors fail without logging response content', async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    const result = await run({ status, body: { error: token } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 1);
  }
});

test('transport failures and malformed JSON never trigger an immediate retry', async () => {
  for (const options of [{ failure: 'timeout' }, { invalidJson: true }]) {
    const result = await run(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 1);
  }
});

test('successful submission and reconciliation remain distinct from anchored results and omit ballot identifiers', async () => {
  for (const status of ['anchored', 'submitted', 'confirmation_pending', 'signer_busy']) {
    const result = await run({ body: { ok: true, status: 'completed', processed: 1, results: [{ status, ballot_id: 'do-not-log-ballot', tx_hash: 'do-not-log-transaction' }] } });
    assert.equal(result.exitCode, undefined);
    assert.ok(result.logs.some(line => line.includes(status + '=1')));
    assert.ok(result.logs.every(line => !line.includes('do-not-log')));
  }
});

test('HTTP 200 with queue failures, transaction persistence failures or manual review marks the run failed', async () => {
  for (const status of ['claim_failed', 'submitted_claim_failed', 'signer_lease_failed', 'manual_review_transition_failed', 'manual_review_required', 'anchor_failed', 'blockchain_submitted_db_persist_failed', 'blockchain_recorded_db_finalize_failed', 'unknown']) {
    const result = await run({ body: { ok: true, status: 'completed', processed: 1, results: [{ status, error: token }] } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, 1);
  }
});

test('inconsistent or unsuccessful responses never become green workflow runs', async () => {
  for (const body of [null, {}, { ok: false }, { ok: true, status: 'idle', processed: 1 }, { ok: true, status: 'completed', processed: 0, results: [] }, { ok: true, status: 'completed', processed: 2, results: [{ status: 'anchored' }] }]) {
    assert.equal((await run({ body })).exitCode, 1);
  }
});

test('deployed worker retains gateway JWT verification', () => {
  assert.match(readFileSync('supabase/config.toml', 'utf8'), /\[functions\.anchor-ballot-hashes\]\s+verify_jwt = true/);
});
