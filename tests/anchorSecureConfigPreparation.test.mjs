import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Interface, Wallet } from 'ethers';
import { project, registry, verifyAnchorConfig } from '../scripts/kandid-anchor-config-check.mjs';

function fixture(overrides = {}) {
  const wallet = Wallet.createRandom();
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'HS256', ...overrides.header })}.${encode({ role: 'anon', ref: project, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides.claims })}.synthetic-signature`;
  const input = { privateKey: wallet.privateKey, rpcUrl: 'https://rpc.invalid/?credential=synthetic-private', gatewayJwt: jwt, registryAddress: registry };
  const calls = [];
  const code = '0x6000';
  const options = {
    expectedOwner: wallet.address,
    runtimeSha256: createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex'),
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (overrides.error) {
        const error = Error(input.rpcUrl + ' ' + input.privateKey + ' ' + jwt);
        if (overrides.errorName) error.name = overrides.errorName;
        if (overrides.errorCode) error.cause = { code: overrides.errorCode };
        throw error;
      }
      if (request.method === 'GET') return { status: overrides.authStatus ?? 200, json: async () => overrides.authBody ?? { external: {} } };
      const { method, params } = JSON.parse(request.body);
      const responses = {
        eth_chainId: overrides.chain ?? '0xaa36a7',
        eth_getCode: overrides.code ?? code,
        eth_call: new Interface(['function owner() view returns (address)']).encodeFunctionResult('owner', [overrides.owner ?? wallet.address]),
        eth_getBalance: overrides.balance ?? '0xa53fa3dc334000',
        eth_getTransactionCount: params[1] === 'pending' ? overrides.pendingNonce ?? '0x1e' : '0x1e',
      };
      assert.ok(Object.hasOwn(responses, method), 'only declared read-only RPC methods are permitted');
      return { status: overrides.rpcStatus ?? 200, json: async () => {
        if (overrides.invalidJson) throw Error(input.rpcUrl);
        return overrides.rpcBody ?? { jsonrpc: '2.0', id: 1, result: responses[method] };
      } };
    },
  };
  return { input, options, calls };
}

test('local verifier derives the signer offline and emits only public results', async () => {
  const { input, options, calls } = fixture();
  const result = await verifyAnchorConfig(input, options);
  assert.equal(result.ok, true);
  assert.equal(result.signer_address, new Wallet(input.privateKey).address);
  assert.equal(result.edge_worker_authentication_tested, false);
  assert.equal(result.production_secret_values_verified, false);
  const output = JSON.stringify(result);
  for (const secret of [input.privateKey, input.gatewayJwt, input.rpcUrl]) assert.ok(!output.includes(secret));
  const auth = calls.find(call => call.request.method === 'GET');
  assert.equal(auth.url, `https://${project}.supabase.co/auth/v1/settings`);
  assert.equal(auth.request.headers.apikey, input.gatewayJwt);
  assert.ok(calls.every(call => call.request.redirect === 'error'));
  assert.ok(calls.every(call => !call.url.includes('/functions/')));
});

test('wrong JWT project, role, or expiration is rejected before any request', async () => {
  for (const claims of [{ ref: 'wrong' }, { role: 'service_role' }, { exp: 1 }]) {
    const { input, options, calls } = fixture({ claims });
    await assert.rejects(verifyAnchorConfig(input, options), /gateway_claims/);
    assert.equal(calls.length, 0);
  }
});

test('wrong chain, wrong runtime code, and different contract owner fail closed', async () => {
  for (const [overrides, stage] of [[{ chain: '0x1' }, 'rpc_chain'], [{ code: '0x6001' }, 'registry_code'], [{ owner: Wallet.createRandom().address }, 'signer_owner']]) {
    const { input, options } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), new RegExp(stage));
  }
});

test('insufficient funds and a pending signer transaction stop verification', async () => {
  for (const [overrides, stage] of [[{ balance: '0x0' }, 'signer_funding'], [{ pendingNonce: '0x1f' }, 'signer_nonce']]) {
    const { input, options } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), new RegExp(stage));
  }
});

test('HTTP failures never expose credentials from transport exceptions', async () => {
  const { input, options } = fixture({ error: true });
  await assert.rejects(verifyAnchorConfig(input, options), error => {
    for (const secret of [input.privateKey, input.gatewayJwt, input.rpcUrl]) assert.ok(!String(error).includes(secret));
    return /rpc_chain/.test(error.message);
  });
});

test('rejected Supabase API credentials do not become a successful preflight', async () => {
  const { input, options } = fixture({ authStatus: 401 });
  await assert.rejects(verifyAnchorConfig(input, options), /project_api_key_acceptance/);
});

test('incorrect registry and unsafe RPC URL are rejected without requests', async () => {
  for (const update of [{ registryAddress: Wallet.createRandom().address }, { rpcUrl: 'http://rpc.invalid' }, { rpcUrl: 'https://user:secret@rpc.invalid' }]) {
    const { input, options, calls } = fixture();
    await assert.rejects(verifyAnchorConfig({ ...input, ...update }, options), /input/);
    assert.equal(calls.length, 0);
  }
});

test('JWT and private-key errors expose exact safe reason codes', async () => {
  for (const [overrides, reason] of [
    [{ claims: { ref: 'wrong' } }, 'JWT_PROJECT_MISMATCH'],
    [{ claims: { role: 'service_role' } }, 'JWT_ROLE_MISMATCH'],
    [{ claims: { exp: 1 } }, 'JWT_EXPIRED_OR_NEAR_EXPIRY'],
    [{ claims: { exp: 'not-a-number' } }, 'JWT_EXPIRATION_INVALID'],
    [{ header: { alg: 'none' } }, 'JWT_ALGORITHM_MISMATCH'],
  ]) {
    const { input, options, calls } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), error => error.stage === 'gateway_claims' && error.reason === reason);
    assert.equal(calls.length, 0);
  }
  const { input, options, calls } = fixture();
  await assert.rejects(verifyAnchorConfig({ ...input, privateKey: 'synthetic-invalid-key' }, options), error => error.stage === 'local_signer' && error.reason === 'PRIVATE_KEY_INVALID');
  assert.equal(calls.length, 0);
});

test('HTTP status, invalid JSON, and RPC errors are classified without forwarding bodies', async () => {
  for (const [overrides, reason] of [
    [{ rpcStatus: 401 }, 'HTTP_UNAUTHORIZED'],
    [{ rpcStatus: 403 }, 'HTTP_FORBIDDEN'],
    [{ rpcStatus: 429 }, 'HTTP_RATE_LIMITED'],
    [{ rpcStatus: 500 }, 'HTTP_ERROR'],
    [{ rpcStatus: 302 }, 'HTTP_REDIRECT'],
    [{ invalidJson: true }, 'INVALID_JSON_RESPONSE'],
    [{ rpcBody: { id: 1, error: { code: -32601, message: 'synthetic-private-diagnostic' } } }, 'RPC_METHOD_UNAVAILABLE'],
    [{ rpcBody: { id: 1, error: { code: -32602, data: 'synthetic-private-diagnostic' } } }, 'RPC_PARAMETERS_REJECTED'],
    [{ rpcBody: { id: 1, error: { code: -32000, message: 'synthetic-private-diagnostic' } } }, 'RPC_ERROR'],
    [{ rpcBody: { id: 2, result: '0xaa36a7' } }, 'RPC_RESPONSE_INVALID'],
    [{ rpcBody: { id: 1, result: 'not-hex' } }, 'RPC_QUANTITY_INVALID'],
  ]) {
    const { input, options } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), error => {
      assert.equal(error.stage, 'rpc_chain');
      assert.equal(error.reason, reason);
      for (const secret of [input.privateKey, input.gatewayJwt, input.rpcUrl, 'synthetic-private-diagnostic']) assert.ok(!String(error).includes(secret));
      return true;
    });
  }
});

test('timeout, DNS, and TLS errors remain distinguishable and sanitized', async () => {
  for (const [overrides, reason] of [
    [{ error: true, errorName: 'TimeoutError' }, 'REQUEST_TIMEOUT'],
    [{ error: true, errorCode: 'ENOTFOUND' }, 'DNS_FAILURE'],
    [{ error: true, errorCode: 'CERT_HAS_EXPIRED' }, 'TLS_FAILURE'],
  ]) {
    const { input, options } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), error => {
      assert.equal(error.reason, reason);
      assert.ok(!String(error).includes(input.rpcUrl));
      return true;
    });
  }
});

test('configuration mismatches retain stop behavior with distinct reasons', async () => {
  for (const [overrides, reason] of [
    [{ chain: '0x1' }, 'CHAIN_ID_MISMATCH'],
    [{ code: '0x' }, 'REGISTRY_CODE_MISSING'],
    [{ code: '0x6001' }, 'REGISTRY_RUNTIME_MISMATCH'],
    [{ balance: '0x0' }, 'SIGNER_BALANCE_INSUFFICIENT'],
    [{ pendingNonce: '0x1f' }, 'SIGNER_PENDING_TRANSACTIONS'],
    [{ authStatus: 401 }, 'HTTP_UNAUTHORIZED'],
    [{ authBody: {} }, 'AUTH_SETTINGS_RESPONSE_INVALID'],
  ]) {
    const { input, options } = fixture(overrides);
    await assert.rejects(verifyAnchorConfig(input, options), error => error.reason === reason);
  }
  const otherOwner = Wallet.createRandom().address;
  const { input, options } = fixture({ owner: otherOwner });
  await assert.rejects(verifyAnchorConfig(input, options), error => error.reason === 'REVIEWED_OWNER_MISMATCH');
  await assert.rejects(verifyAnchorConfig(input, { ...options, expectedOwner: otherOwner }), error => error.reason === 'SIGNER_OWNER_MISMATCH');
});

test('CLI reports structured safe diagnostics and never repeats malformed input', () => {
  const { input } = fixture({ claims: { exp: 1 } });
  const child = spawnSync(process.execPath, ['scripts/kandid-anchor-config-check.mjs'], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stdout), { ok: false, stage: 'gateway_claims', reason: 'JWT_EXPIRED_OR_NEAR_EXPIRY' });
  for (const secret of [input.privateKey, input.gatewayJwt, input.rpcUrl]) assert.ok(!(child.stdout + child.stderr).includes(secret));
  const malformed = spawnSync(process.execPath, ['scripts/kandid-anchor-config-check.mjs'], { input: 'synthetic-private-invalid-json', encoding: 'utf8' });
  assert.equal(malformed.status, 1);
  assert.deepEqual(JSON.parse(malformed.stdout), { ok: false, stage: 'input', reason: 'INPUT_JSON_INVALID' });
  assert.ok(!(malformed.stdout + malformed.stderr).includes('synthetic-private-invalid-json'));
});

test('PowerShell 5.1 wrapper preserves only allowlisted diagnostics with mocked child processes', { skip: process.platform !== 'win32' }, () => {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'kandid-config-diagnostics-'));
  try {
    const scripts = join(root, 'scripts');
    mkdirSync(scripts);
    const wrapper = join(scripts, 'verify-kandid-anchor-config.ps1');
    copyFileSync('scripts/verify-kandid-anchor-config.ps1', wrapper);
    const harness = join(root, 'harness.ps1');
    writeFileSync(harness, `function global:Read-Host { param([string]$Prompt, [switch]$AsSecureString) ConvertTo-SecureString 'synthetic-hidden-input' -AsPlainText -Force }\n& '${wrapper.replaceAll("'", "''")}'\nexit $LASTEXITCODE\n`);
    const scenarios = [
      [{ ok: false, stage: 'rpc_chain', reason: 'HTTP_UNAUTHORIZED', message: 'synthetic-private-diagnostic' }, 1, 'rpc_chain', 'HTTP_UNAUTHORIZED'],
      [{ ok: false, stage: 'project_api_key_acceptance', reason: 'HTTP_FORBIDDEN' }, 1, 'project_api_key_acceptance', 'HTTP_FORBIDDEN'],
      [{ ok: false, stage: 'gateway_claims', reason: 'JWT_EXPIRED_OR_NEAR_EXPIRY' }, 1, 'gateway_claims', 'JWT_EXPIRED_OR_NEAR_EXPIRY'],
      [{ ok: false, stage: 'synthetic-private-diagnostic', reason: 'synthetic-private-diagnostic' }, 1, 'helper_response', 'HELPER_OUTPUT_INVALID'],
      [null, 1, 'helper_response', 'HELPER_STARTUP_FAILED'],
      ['malformed', 1, 'helper_response', 'HELPER_OUTPUT_INVALID'],
      [{ ok: true }, 1, 'helper_response', 'HELPER_EXIT_FAILURE'],
      [{
        ok: true, chain_id: 11155111, registry, registry_runtime_matches_review: true,
        signer_address: '0x70d276359a4249d49E6302106171378D99C5db3F',
        contract_owner: '0x70d276359a4249d49E6302106171378D99C5db3F', signer_matches_owner: true,
        signer_balance_eth: '0.05', minimum_balance_check: true, pending_nonce_matches_latest: true,
        gateway_project_claim_matches: true, gateway_role: 'anon', gateway_algorithm: 'HS256',
        gateway_expires_at: '2028-01-01T00:00:00.000Z', project_api_key_accepted: true,
        edge_worker_authentication_tested: false, production_secret_values_verified: false,
        unexpected_secret: 'synthetic-private-diagnostic',
      }, 0, null, null],
    ];
    for (const [result, status, stage, reason] of scenarios) {
      const output = result === null ? '' : result === 'malformed' ? 'synthetic-private-diagnostic' : JSON.stringify(result);
      writeFileSync(join(scripts, 'kandid-anchor-config-check.mjs'), `process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('synthetic-private-diagnostic');process.stdout.write(${JSON.stringify(output)});process.exitCode=${status};});`);
      // This child process runs only our synthetic fixture; no machine/user
      // execution policy is changed and production execution gains no bypass.
      const child = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { encoding: 'utf8', timeout: 20000 });
      assert.equal(child.status, status, 'wrapper exit must reflect verification result');
      const report = JSON.parse(child.stdout.replace(/^\uFEFF/, ''));
      if (status === 0) {
        assert.equal(report.ok, true);
        assert.equal(report.unexpected_secret, undefined);
        assert.equal(report.registry, registry);
      } else {
        assert.equal(report.stage, stage);
        assert.equal(report.reason, reason);
        assert.equal(report.ok, false);
        assert.equal(report.stopped_before_configuration, true);
      }
      assert.ok(!(child.stdout + child.stderr).includes('synthetic-private-diagnostic'));
      assert.ok(!(child.stdout + child.stderr).includes('synthetic-hidden-input'));
    }
    assert.ok(readFileSync(wrapper, 'utf8').includes('Get-SafeVerificationFailure'));
  } finally {
    // Only this test's newly created directory may be removed.
    if (dirname(root) !== parent || !basename(root).startsWith('kandid-config-diagnostics-')) throw Error('Unsafe fixture cleanup path');
    rmSync(root, { recursive: true });
  }
});
