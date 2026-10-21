import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Interface, Wallet, formatEther, getAddress } from 'ethers';

export const project = 'fszgdxqxonqqcrzsnkca';
export const registry = '0x91fB285801A80017Db3A5a75F0b797a2B4c4198A';
const reviewedOwner = '0x70d276359a4249d49E6302106171378D99C5db3F';
const reviewedRuntimeSha256 = 'e2931cc609f100b8c21856a4134bba21ae82161b5598792b134c524d37f34f26';
const ownerInterface = new Interface(['function owner() view returns (address)']);

class VerificationFailure extends Error {
  constructor(stage, reason) {
    super(`Configuration verification failed at ${stage} (${reason}).`);
    this.stage = stage;
    this.reason = reason;
  }
}

// This helper has no transaction, worker-invocation, or configuration-write path.
// Never forward exceptions: provider errors can contain private RPC URLs.
export async function verifyAnchorConfig(input, { fetchImpl = globalThis.fetch, runtimeSha256 = reviewedRuntimeSha256, expectedOwner = reviewedOwner } = {}) {
  let stage = 'input';
  const fail = reason => { throw new VerificationFailure(stage, reason); };
  const requestJson = async (url, options) => {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error?.name) || error?.cause?.code === 'ETIMEDOUT') fail('REQUEST_TIMEOUT');
      if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code)) fail('DNS_FAILURE');
      if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error?.cause?.code)) fail('TLS_FAILURE');
      fail('NETWORK_FAILURE');
    }
    if (response.status === 401) fail('HTTP_UNAUTHORIZED');
    if (response.status === 403) fail('HTTP_FORBIDDEN');
    if (response.status === 429) fail('HTTP_RATE_LIMITED');
    if (response.status >= 300 && response.status < 400) fail('HTTP_REDIRECT');
    if (response.status !== 200) fail('HTTP_ERROR');
    try { return await response.json(); }
    catch { fail('INVALID_JSON_RESPONSE'); }
  };
  const quantity = value => {
    if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) fail('RPC_QUANTITY_INVALID');
    return BigInt(value);
  };
  try {
    if (typeof fetchImpl !== 'function' || typeof globalThis.AbortSignal?.timeout !== 'function') fail('NODE_RUNTIME_UNSUPPORTED');
    if (!input || typeof input.privateKey !== 'string' || typeof input.rpcUrl !== 'string' || typeof input.gatewayJwt !== 'string') fail('INPUT_FIELDS_MISSING');
    let rpcUrl;
    try { rpcUrl = new URL(input.rpcUrl); } catch { fail('RPC_URL_INVALID'); }
    if (rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password || rpcUrl.hash) fail('RPC_URL_UNSAFE');
    let suppliedRegistry;
    try { suppliedRegistry = getAddress(input.registryAddress); } catch { fail('REGISTRY_ADDRESS_INVALID'); }
    if (suppliedRegistry !== getAddress(registry)) fail('REGISTRY_ADDRESS_MISMATCH');

    stage = 'gateway_claims';
    const parts = input.gatewayJwt.split('.');
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) fail('JWT_FORMAT_INVALID');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { fail('JWT_JSON_INVALID'); }
    if (!header || !claims || typeof header !== 'object' || typeof claims !== 'object') fail('JWT_JSON_INVALID');
    if (header.alg !== 'HS256') fail('JWT_ALGORITHM_MISMATCH');
    if (claims.role !== 'anon') fail('JWT_ROLE_MISMATCH');
    if (claims.ref !== project) fail('JWT_PROJECT_MISMATCH');
    if (!Number.isFinite(claims.exp) || !Number.isFinite(new Date(claims.exp * 1000).getTime())) fail('JWT_EXPIRATION_INVALID');
    if (claims.exp * 1000 <= Date.now() + 60000) fail('JWT_EXPIRED_OR_NEAR_EXPIRY');

    stage = 'local_signer';
    // Deliberately offline: the wallet is never connected to any provider.
    let signer;
    try { signer = new Wallet(input.privateKey).address; } catch { fail('PRIVATE_KEY_INVALID'); }
    const rpc = async (method, params) => {
      const data = await requestJson(input.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (data?.error?.code === -32601) fail('RPC_METHOD_UNAVAILABLE');
      if (data?.error?.code === -32602) fail('RPC_PARAMETERS_REJECTED');
      if (data?.error) fail('RPC_ERROR');
      if (!data || data.id !== 1 || data.result === undefined) fail('RPC_RESPONSE_INVALID');
      return data.result;
    };

    stage = 'rpc_chain';
    if (quantity(await rpc('eth_chainId', [])) !== 11155111n) fail('CHAIN_ID_MISMATCH');
    stage = 'registry_code';
    const code = await rpc('eth_getCode', [registry, 'latest']);
    if (code === '0x') fail('REGISTRY_CODE_MISSING');
    if (typeof code !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(code)) fail('REGISTRY_CODE_INVALID');
    const actualRuntimeHash = createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
    if (actualRuntimeHash !== runtimeSha256) fail('REGISTRY_RUNTIME_MISMATCH');
    stage = 'signer_owner';
    const ownerResult = await rpc('eth_call', [{ to: registry, data: ownerInterface.encodeFunctionData('owner') }, 'latest']);
    let owner;
    try { owner = getAddress(ownerInterface.decodeFunctionResult('owner', ownerResult)[0]); } catch { fail('OWNER_RESPONSE_INVALID'); }
    if (owner !== getAddress(expectedOwner)) fail('REVIEWED_OWNER_MISMATCH');
    if (signer !== owner) fail('SIGNER_OWNER_MISMATCH');
    stage = 'signer_funding';
    const balance = quantity(await rpc('eth_getBalance', [signer, 'latest']));
    if (balance < 1000000000000000n) fail('SIGNER_BALANCE_INSUFFICIENT');
    stage = 'signer_nonce';
    const latestNonce = quantity(await rpc('eth_getTransactionCount', [signer, 'latest']));
    const pendingNonce = quantity(await rpc('eth_getTransactionCount', [signer, 'pending']));
    if (latestNonce !== pendingNonce) fail('SIGNER_PENDING_TRANSACTIONS');

    stage = 'project_api_key_acceptance';
    const settings = await requestJson(`https://${project}.supabase.co/auth/v1/settings`, {
      method: 'GET',
      headers: { apikey: input.gatewayJwt, Authorization: 'Bearer ' + input.gatewayJwt },
    });
    if (!settings || typeof settings.external !== 'object' || settings.external === null) fail('AUTH_SETTINGS_RESPONSE_INVALID');
    return {
      ok: true, chain_id: 11155111, registry, registry_runtime_matches_review: true,
      signer_address: signer, contract_owner: owner, signer_matches_owner: true,
      signer_balance_eth: formatEther(balance), minimum_balance_check: true,
      pending_nonce_matches_latest: true, gateway_project_claim_matches: true,
      gateway_role: 'anon', gateway_algorithm: 'HS256',
      gateway_expires_at: new Date(claims.exp * 1000).toISOString(),
      project_api_key_accepted: true, edge_worker_authentication_tested: false,
      production_secret_values_verified: false,
    };
  } catch (error) {
    if (error instanceof VerificationFailure) throw error;
    throw new VerificationFailure(stage, 'INTERNAL_FAILURE');
  }
}

async function main() {
  let payload = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      payload += chunk;
      if (payload.length > 32768) throw new VerificationFailure('input', 'INPUT_TOO_LARGE');
    }
    let input;
    try { input = JSON.parse(payload); } catch { throw new VerificationFailure('input', 'INPUT_JSON_INVALID'); }
    const result = await verifyAnchorConfig(input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const failure = error instanceof VerificationFailure ? { stage: error.stage, reason: error.reason } : { stage: 'input', reason: 'INTERNAL_FAILURE' };
    process.stdout.write(JSON.stringify({ ok: false, ...failure }) + '\n');
    process.exitCode = 1;
  } finally {
    payload = '';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
