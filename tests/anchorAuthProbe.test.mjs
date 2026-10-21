// Entirely local: actual worker handler, forbidden side-effect spies, and a
// synthetic cryptographic gateway model. This does NOT verify the hosted gateway.
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { transformSync } from 'esbuild';
import test from 'node:test';

const source = readFileSync('supabase/functions/anchor-ballot-hashes/index.ts', 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code.replace(/^import\s[\s\S]*?;\n/gm, '');
const baselineLfSha = '81c35f4c12123238dc32b19bc97eb22268c0934407088dcff8515ab3d4a43ff0';
const probeBlock = `  // Authentication-only probe. The platform must retain verify_jwt=true.
  // Exit before database/blockchain configuration, clients, claims or leases.
  if (req.method === "HEAD") {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Kandid-Anchor-Probe": "ok",
      },
    });
  }

`;
const workerToken = 'synthetic-worker-token';
const signingKey = 'synthetic-project-gateway-signing-key';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt({ claims = {}, key = signingKey } = {}) {
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', ref: 'fszgdxqxonqqcrzsnkca', exp: Math.floor(Date.now()/1000)+3600, ...claims })}`;
  return data + '.' + createHmac('sha256', key).update(data).digest('base64url');
}

function harness({ configuredToken = workerToken } = {}) {
  const effects = [], envReads = [], logs = [];
  let handler;
  const forbid = name => () => { effects.push(name); throw Error('Forbidden synthetic side effect: ' + name); };
  const bindings = {
    ethers: {
      Interface: class {}, // Pure ABI parser constructed at module load, no client/network.
      JsonRpcProvider: class { constructor() { forbid('provider construction')(); } },
      Wallet: class { constructor() { forbid('signer construction')(); } },
      Contract: class { constructor() { forbid('contract construction')(); } },
    },
    createClient: forbid('database client construction'),
    verifyLegacyVoteAnchorEvidence: forbid('evidence/reconciliation'),
    fetch: forbid('network'),
    Deno: {
      env: { get(key) { envReads.push(key); if (key !== 'ANCHOR_WORKER_TOKEN') forbid('other server configuration')(); return configuredToken; } },
      serve(fn) { handler = fn; },
    },
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  };
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  let handlerRequests = 0;
  async function request({ method = 'HEAD', token = workerToken, authorization, gateway = false, body } = {}) {
    const headers = new Headers();
    if (token !== null) headers.set('x-anchor-worker-token', token);
    if (authorization !== undefined) headers.set('Authorization', authorization);
    if (gateway) {
      // Model the existing platform boundary, not an extra production JWT verifier.
      // No real signing key, remote verification service, or production token is used.
      let valid = false;
      try {
        const [scheme, credential] = (headers.get('Authorization') ?? '').split(' ');
        const parts = credential.split('.');
        if (scheme !== 'Bearer' || parts.length !== 3) throw Error('Reject');
        const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
        const expected = createHmac('sha256', signingKey).update(parts[0]+'.'+parts[1]).digest();
        const actual = Buffer.from(parts[2], 'base64url');
        valid = header.alg === 'HS256' && Number.isFinite(claims.exp) && claims.exp > Date.now()/1000 && actual.length === expected.length && timingSafeEqual(actual, expected);
      } catch { /* Fixed rejection, no credentials or raw errors forwarded. */ }
      if (!valid) return new Response(null, { status: 401 });
    }
    handlerRequests++;
    const req = new Request('https://synthetic.invalid/anchor-ballot-hashes', { method, headers, body });
    req.json = forbid('request body parsing');
    return handler(req);
  }
  return { effects, envReads, logs, request, handlerRequests: () => handlerRequests };
}

test('the entire preexisting worker is unchanged after removing only the HEAD probe additions', () => {
  const normalized = source.replaceAll('\r\n','\n');
  assert.equal(normalized.split(probeBlock).length, 2, 'one exact early-return block');
  const reconstructed = normalized.replace(probeBlock, '').replace('req.method !== "POST" && req.method !== "HEAD"', 'req.method !== "POST"');
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'), baselineLfSha);
});

test('gateway JWT verification remains required for this same deployed function', () => {
  const config = readFileSync('supabase/config.toml','utf8');
  assert.match(config, /\[functions\.anchor-ballot-hashes\]\s+verify_jwt\s*=\s*true/);
  assert.ok(source.indexOf('providedWorkerToken !== anchorWorkerToken') < source.indexOf('if (req.method === "HEAD")'));
  assert.ok(source.indexOf('if (req.method === "HEAD")') < source.indexOf('const supabaseUrl ='));
});

test('valid worker authentication returns a minimal uncached probe without clients or server credential reads', async () => {
  const h = harness();
  for (let i=0;i<3;i++) {
    const response = await h.request();
    assert.equal(response.status,204);
    assert.equal(await response.text(),'');
    assert.deepEqual([...response.headers], [['cache-control','no-store'],['x-kandid-anchor-probe','ok']]);
  }
  assert.deepEqual(h.envReads,Array(3).fill('ANCHOR_WORKER_TOKEN'));
  assert.deepEqual(h.effects,[]);
  assert.deepEqual(h.logs,[]);
});

test('missing, empty and invalid worker tokens cannot use the probe', async () => {
  for (const token of [null,'','wrong-token']) {
    const h = harness();
    const response = await h.request({token});
    assert.equal(response.status,401);
    assert.equal(response.headers.get('x-kandid-anchor-probe'),null);
    assert.deepEqual(await response.json(),{ok:false,error:'Unauthorized.'});
    assert.deepEqual(h.effects,[]);
    assert.deepEqual(h.envReads,['ANCHOR_WORKER_TOKEN']);
  }
});

test('unconfigured worker authentication fails closed before the probe', async () => {
  const h=harness({configuredToken:null});
  assert.equal((await h.request()).status,500);
  assert.deepEqual(h.effects,[]);
  assert.deepEqual(h.envReads,['ANCHOR_WORKER_TOKEN']);
});

test('other HTTP methods retain their rejection and never initialize clients', async () => {
  for (const method of ['GET','OPTIONS','PUT','PATCH','DELETE']) {
    const h=harness();
    assert.equal((await h.request({method})).status,405);
    assert.deepEqual(h.effects,[]);
    assert.deepEqual(h.envReads,[]);
  }
});

test('synthetic gateway accepts a correctly signed JWT followed by the independent worker-token check', async () => {
  const h=harness();
  const response=await h.request({gateway:true,authorization:'Bearer '+jwt()});
  assert.equal(response.status,204);
  assert.equal(h.handlerRequests(),1);
  assert.deepEqual(h.effects,[]);
});

test('synthetic gateway rejects missing, malformed, expired, forged and wrong-project signing credentials before the handler', async () => {
  const valid=jwt();
  const forged=valid.split('.');forged[1]=encode({role:'anon',ref:'fszgdxqxonqqcrzsnkca',exp:9999999999});
  for (const authorization of [undefined,'Bearer not-a-jwt','Bearer sb_publishable_synthetic','Bearer '+jwt({claims:{exp:1}}),'Bearer '+jwt({key:'synthetic-other-project-key'}),'Bearer '+forged.join('.')]) {
    const h=harness();
    assert.equal((await h.request({gateway:true,authorization})).status,401);
    assert.equal(h.handlerRequests(),0);
    assert.deepEqual(h.envReads,[]);
    assert.deepEqual(h.effects,[]);
  }
});

test('a gateway-valid request with an invalid worker token fails the second boundary without side effects', async () => {
  const h=harness();
  assert.equal((await h.request({gateway:true,authorization:'Bearer '+jwt(),token:'wrong-token'})).status,401);
  assert.equal(h.handlerRequests(),1);
  assert.deepEqual(h.envReads,['ANCHOR_WORKER_TOKEN']);
  assert.deepEqual(h.effects,[]);
});

test('POST probe-like payloads cannot bypass worker authentication', async () => {
  const h=harness();
  const response=await h.request({method:'POST',token:'wrong-token',body:JSON.stringify({mode:'auth-only',dry_run:true})});
  assert.equal(response.status,401);
  assert.deepEqual(h.effects,[]);
});

test('documented live-probe commands parse in Windows PowerShell 5.1 without execution', { skip: process.platform !== 'win32' }, () => {
  const doc=readFileSync('docs/anchor-auth-probe.md','utf8');
  const blocks=[...doc.matchAll(/```powershell\r?\n([\s\S]*?)```/g)].map(m=>m[1]);
  assert.equal(blocks.length,3);
  assert.match(blocks[2], /\[Net\.Http\.HttpMethod\]::Head/);
  assert.ok(!/HttpMethod\]::Post|Method\s+POST|Invoke-RestMethod|Invoke-WebRequest/.test(blocks[2]));
  assert.match(blocks[2], /AllowAutoRedirect = \$false/);
  assert.match(blocks[2], /Read-Host \$Prompt -AsSecureString/);
  assert.ok(!/\.Content\.|Write-(?:Host|Output).*\$(?:jwt|workerToken|Bearer|Token)|Exception\./.test(blocks[2]));
  for(const block of blocks) {
    const child=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command', '$text=[Console]::In.ReadToEnd();$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){exit 1};$PSVersionTable.PSVersion.ToString()'],{input:block,encoding:'utf8'});
    assert.equal(child.status,0);
    assert.match(child.stdout,/^5\.1/);
  }
});
