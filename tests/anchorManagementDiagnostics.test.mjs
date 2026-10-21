import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scripts = ['kandid-anchor-management.ps1', 'preflight-kandid-anchor-secrets.ps1', 'configure-kandid-anchor-secrets.ps1'];
const project = 'fszgdxqxonqqcrzsnkca';
const names = ['SEPOLIA_RPC_URL', 'DEPLOYER_PRIVATE_KEY', 'VOTE_REGISTRY_ADDRESS', 'ANCHOR_WORKER_TOKEN'];
const marker = 'synthetic-private-diagnostic';

// A sealed in-memory HttpMessageHandler has no network fallback. We execute the
// actual PowerShell scripts and HTTP handling; only transport and gh/node are mocked.
const handler = `
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
public sealed class KandidFixtureHandler : HttpMessageHandler {
  public static string Scenario;
  public static List<string> Calls = new List<string>();
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken c) {
    var path = r.RequestUri.AbsolutePath;
    Calls.Add(r.Method.Method + " " + r.RequestUri.GetLeftPart(UriPartial.Path));
    bool list = path.EndsWith("/secrets");
    bool post = r.Method == HttpMethod.Post;
    if (r.RequestUri.Host != "api.supabase.com" || !path.StartsWith("/v1/projects/${project}") || (r.Method != HttpMethod.Get && !post)) throw new Exception("${marker}");
    if (post) {
      var payload = r.Content.ReadAsStringAsync().GetAwaiter().GetResult();
      if (System.Text.RegularExpressions.Regex.Matches(payload, "\\\"name\\\"").Count != 4) throw new Exception("${marker}");
      foreach (var name in new [] { "SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY", "VOTE_REGISTRY_ADDRESS", "ANCHOR_WORKER_TOKEN" }) {
        if (!payload.Contains(name)) throw new Exception("${marker}");
      }
      if (!payload.Contains(new string('w', 48))) throw new Exception("${marker}");
    }
    if (Scenario == "network" || (Scenario == "postLost" && post)) throw new HttpRequestException("${marker}");
    if (Scenario == "timeout" && !list) throw new TaskCanceledException("${marker}");
    if (Scenario == "dns" && !list) throw new HttpRequestException("${marker}", new System.Net.Sockets.SocketException(11001));
    if (Scenario == "tls" && !list) throw new HttpRequestException("${marker}", new System.Security.Authentication.AuthenticationException("${marker}"));
    int status = post ? 201 : 200;
    if (Scenario == "project403" && !list) status = 403;
    if (Scenario == "project401" && !list) status = 401;
    if (Scenario == "list403" && list) status = 403;
    if (Scenario == "post500" && post) status = 500;
    if (Scenario == "redirect" && !list) status = 302;
    string body = list ? "[{\\\"name\\\":\\\"SEPOLIA_RPC_URL\\\",\\\"value\\\":\\\"${marker}\\\"},{\\\"name\\\":\\\"DEPLOYER_PRIVATE_KEY\\\"},{\\\"name\\\":\\\"VOTE_REGISTRY_ADDRESS\\\"},{\\\"name\\\":\\\"ANCHOR_WORKER_TOKEN\\\"}]" : "{\\\"id\\\":\\\"${project}\\\",\\\"status\\\":\\\"ACTIVE_HEALTHY\\\"}";
    if (Scenario == "projectWrong" && !list) body = "{\\\"id\\\":\\\"wrong\\\",\\\"status\\\":\\\"ACTIVE_HEALTHY\\\"}";
    if (Scenario == "badJson" && !list) body = "${marker}";
    if (Scenario == "emptyMetadata" && list) body = "[]";
    if (Scenario == "objectMetadata" && list) body = "{}";
    if (status >= 300) body = "${marker}";
    // This is deliberately invalid JSON: successful POST headers suffice, and
    // write acknowledgments must not depend on parsing a response body.
    if (post && status == 201) body = "${marker}";
    return Task.FromResult(new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(body) });
  }
}`;

function psLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

function runFixture(entry, scenario) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'kandid-management-diagnostics-'));
  try {
    const folder = join(root, 'scripts');
    mkdirSync(folder);
    for (const file of scripts) copyFileSync(join('scripts', file), join(folder, file));
    const helperPath = join(folder, scripts[0]);
    writeFileSync(helperPath, readFileSync(helperPath, 'utf8') + `
function New-KandidManagementClient { return (New-Object Net.Http.HttpClient((New-Object KandidFixtureHandler))) }
`);
    // Replace only the copied script's native process function, never production code.
    const configPath = join(folder, scripts[2]);
    const config = readFileSync(configPath, 'utf8');
    const start = config.indexOf('function Invoke-MemoryProcess {');
    const end = config.indexOf('function Assert-SchedulerDisabled {', start);
    assert.ok(start >= 0 && end > start);
    writeFileSync(configPath, config.slice(0, start) + `
function Invoke-MemoryProcess {
  param([string]$Executable, [string]$Arguments, [string]$InputText)
  $global:commands.Add($Arguments)
  if ($Arguments -like '*KANDID_ANCHOR_SCHEDULER_ENABLED*') { if($global:scenario -eq 'schedulerTrue'){return 'true'}; return 'false' }
  if ($Arguments -eq 'api user --jq .login') { return 'brenduling' }
  if ($Arguments -like '*--jq .full_name') { return 'brenduling/kandid' }
  if ($Arguments -like '*kandid-anchor-config-check.mjs*') { return '{"ok":true,"unexpected_secret":"${marker}"}' }
  if ($Arguments -like 'secret set *') {
    if ($Arguments -like '*KANDID_ANCHOR_WORKER_TOKEN*' -and $InputText -cne ('w'*48)) { throw '${marker}' }
    if ($Arguments -like '*KANDID_ANCHOR_GATEWAY_JWT*' -and $InputText -cne 'synthetic-hidden-input') { throw '${marker}' }
    if (($global:scenario -eq 'githubWorkerFail' -and $Arguments -like '*KANDID_ANCHOR_WORKER_TOKEN*') -or ($global:scenario -eq 'githubGatewayFail' -and $Arguments -like '*KANDID_ANCHOR_GATEWAY_JWT*')) { $diagnostic.reason='PROCESS_EXIT_FAILURE'; throw '${marker}' }
    return ''
  }
  if ($Arguments -like '*actions/secrets*') { return '["KANDID_ANCHOR_GATEWAY_JWT","KANDID_ANCHOR_WORKER_TOKEN"]' }
  throw '${marker}'
}
` + config.slice(end));
    const harness = join(root, 'harness.ps1');
    writeFileSync(harness, `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -ReferencedAssemblies System.Net.Http -TypeDefinition ${psLiteral(handler)}
$global:scenario=${psLiteral(scenario)}
[KandidFixtureHandler]::Scenario=$global:scenario
$global:commands=New-Object 'System.Collections.Generic.List[string]'
function global:gh {}
function global:Read-Host {
  param([string]$Prompt,[switch]$AsSecureString)
  if(-not $AsSecureString) { if($global:scenario -eq 'cancelled'){return 'no'}; return 'CONFIGURE KANDID SECRETS' }
  if($Prompt -like '*Single CSPRNG*') { return (ConvertTo-SecureString ('w'*48) -AsPlainText -Force) }
  return (ConvertTo-SecureString 'synthetic-hidden-input' -AsPlainText -Force)
}
$global:LASTEXITCODE=0
$output=@(& ${psLiteral(join(folder, entry))})
$code=$LASTEXITCODE
[pscustomobject]@{exit_code=$code;result=(($output -join "\n") | ConvertFrom-Json);calls=@([KandidFixtureHandler]::Calls);commands=@($global:commands.ToArray());powershell_version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Depth 8
`);
    const child = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, `synthetic harness failed: ${child.stderr}`);
    assert.ok(!(child.stdout + child.stderr).includes(marker), 'no raw diagnostics or metadata values');
    assert.ok(!(child.stdout + child.stderr).includes('synthetic-hidden-input'), 'no entered token');
    assert.ok(!(child.stdout + child.stderr).includes('w'.repeat(48)), 'no worker token');
    return JSON.parse(child.stdout.replace(/^\uFEFF/, ''));
  } finally {
    if (dirname(root) !== parent || !basename(root).startsWith('kandid-management-diagnostics-')) throw Error('Unsafe fixture cleanup path');
    rmSync(root, { recursive: true });
  }
}

test('preflight exposes only fixed GET requests and no write or worker path', () => {
  const source = readFileSync('scripts/preflight-kandid-anchor-secrets.ps1', 'utf8');
  assert.ok(!/\b(?:POST|PUT|PATCH|DELETE)\b|secret set|\/functions\/v1/.test(source));
  assert.match(source, /Read-Host[^\n]+-AsSecureString/);
  const helper = readFileSync('scripts/kandid-anchor-management.ps1', 'utf8');
  assert.match(helper, /AllowAutoRedirect = \$false/);
  assert.match(helper, /ResponseHeadersRead/);
  assert.ok(!/Write-(?:Host|Output|Error|Verbose|Debug).*Exception/.test(helper));
});

const windows = { skip: process.platform !== 'win32' };
test('PowerShell 5.1 parses all management scripts', windows, () => {
  for (const file of scripts) {
    const command = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(${psLiteral(join(process.cwd(), 'scripts', file))},[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1};$PSVersionTable.PSVersion.ToString()`;
    const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.match(child.stdout, /^5\.1/);
  }
});

test('diagnostic allowlist rejects unknown stages, reasons, and unsafe status fields', windows, () => {
  const command = `. ${psLiteral(join(process.cwd(), 'scripts', scripts[0]))};Get-KandidSafeDiagnostic @{stage='${marker}';reason='${marker}';http_status='${marker}'} | ConvertTo-Json`;
  // Process-local policy for this synthetic, non-network helper test only.
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { stage: 'local_setup', reason: 'INTERNAL_FAILURE', http_status: null });
  assert.ok(!(child.stdout + child.stderr).includes(marker));
});

test('read-only preflight checks both permissions and suppresses secret metadata values', windows, () => {
  const { result, calls, commands } = runFixture(scripts[1], 'success');
  assert.equal(result.ok, true);
  assert.equal(result.required_read_permissions_verified, true);
  assert.equal(result.write_permission_verified, false);
  assert.equal(result.stored_secret_values_verified, false);
  assert.equal(result.write_attempted, false);
  assert.deepEqual(result.secret_metadata_check.approved_secret_names_present, names);
  assert.deepEqual(calls, [`GET https://api.supabase.com/v1/projects/${project}`, `GET https://api.supabase.com/v1/projects/${project}/secrets`]);
  assert.deepEqual(commands, []);
});

for (const [scenario, key, reason, status] of [
  ['project403', 'project_check', 'HTTP_FORBIDDEN', 403],
  ['project401', 'project_check', 'HTTP_UNAUTHORIZED', 401],
  ['list403', 'secret_metadata_check', 'HTTP_FORBIDDEN', 403],
  ['network', 'project_check', 'NETWORK_FAILURE', null],
  ['timeout', 'project_check', 'REQUEST_TIMEOUT', null],
  ['dns', 'project_check', 'DNS_FAILURE', null],
  ['tls', 'project_check', 'TLS_FAILURE', null],
  ['redirect', 'project_check', 'HTTP_REDIRECT', 302],
  ['projectWrong', 'project_check', 'PROJECT_MISMATCH', 200],
  ['badJson', 'project_check', 'INVALID_JSON_RESPONSE', 200],
  ['objectMetadata', 'secret_metadata_check', 'INVALID_JSON_RESPONSE', 200],
]) {
  test(`preflight safely classifies ${scenario} and independently attempts both reads`, windows, () => {
    const { result, calls, exit_code: code } = runFixture(scripts[1], scenario);
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    assert.equal(result[key].reason, reason);
    assert.equal(result[key].http_status, status);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.startsWith('GET ')));
    if ([401, 403].includes(status)) assert.equal(result[key].access_granted, false);
    if (status === null) assert.equal(result[key].access_granted, null);
  });
}

test('empty secret inventory still proves read access without claiming configured credentials', windows, () => {
  const { result } = runFixture(scripts[1], 'emptyMetadata');
  assert.equal(result.ok, true);
  assert.deepEqual(result.secret_metadata_check.approved_secret_names_present, []);
});

for (const [scenario, stage, reason] of [
  ['project403', 'supabase_project_read', 'HTTP_FORBIDDEN'],
  ['list403', 'supabase_secret_list_read', 'HTTP_FORBIDDEN'],
  ['network', 'supabase_project_read', 'NETWORK_FAILURE'],
  ['cancelled', 'confirmation', 'CONFIRMATION_REQUIRED'],
  ['schedulerTrue', 'github_scheduler', 'SCHEDULER_NOT_DISABLED'],
]) {
  test(`configuration refuses writes on ${scenario}`, windows, () => {
    const { result, calls, commands } = runFixture(scripts[2], scenario);
    assert.equal(result.ok, false);
    assert.equal(result.stage, stage);
    assert.equal(result.reason, reason);
    for (const field of ['supabase_write_attempted', 'supabase_writes_acknowledged', 'github_worker_write_attempted', 'github_gateway_write_attempted', 'write_outcome_unknown']) assert.equal(result[field], false);
    assert.ok(!calls.some(call => call.startsWith('POST ')));
    assert.ok(!commands.some(command => command.startsWith('secret set ')));
  });
}

for (const [scenario, reason, status] of [['postLost', 'NETWORK_FAILURE', null], ['post500', 'HTTP_ERROR', 500]]) {
  test(`configuration reports ambiguous ${scenario} without retrying or proceeding to GitHub writes`, windows, () => {
    const { result, calls, commands } = runFixture(scripts[2], scenario);
    assert.equal(result.stage, 'supabase_secret_write');
    assert.equal(result.reason, reason);
    assert.equal(result.http_status, status);
    assert.equal(result.supabase_write_attempted, true);
    assert.equal(result.supabase_writes_acknowledged, false);
    assert.equal(result.write_outcome_unknown, true);
    assert.equal(result.github_worker_write_attempted, false);
    assert.equal(calls.filter(call => call.startsWith('POST ')).length, 1);
    assert.ok(!commands.some(command => command.startsWith('secret set ')));
  });
}

for (const scenario of ['githubWorkerFail', 'githubGatewayFail']) {
  test(`configuration records per-platform acknowledgments for ${scenario}`, windows, () => {
    const { result } = runFixture(scripts[2], scenario);
    assert.equal(result.ok, false);
    assert.equal(result.supabase_writes_acknowledged, true);
    assert.equal(result.github_worker_write_attempted, true);
    assert.equal(result.github_worker_write_acknowledged, scenario === 'githubGatewayFail');
    assert.equal(result.github_gateway_write_attempted, scenario === 'githubGatewayFail');
    assert.equal(result.github_gateway_write_acknowledged, false);
    assert.equal(result.write_outcome_unknown, true);
  });
}

test('configuration retains six-secret scope, same token input, and all scheduler/confirmation gates', windows, () => {
  const { result, calls, commands, exit_code: code } = runFixture(scripts[2], 'success');
  assert.equal(code, 0);
  assert.equal(result.ok, true);
  assert.equal(result.supabase_write_attempted, true);
  assert.equal(result.supabase_writes_acknowledged, true);
  assert.equal(result.github_gateway_write_acknowledged, true);
  assert.equal(result.same_worker_token_input_used, true);
  assert.deepEqual(result.supabase_secret_names_verified, names);
  assert.deepEqual(commands.filter(command => command.startsWith('secret set ')), [
    'secret set KANDID_ANCHOR_WORKER_TOKEN --repo brenduling/kandid',
    'secret set KANDID_ANCHOR_GATEWAY_JWT --repo brenduling/kandid',
  ]);
  assert.equal(calls.filter(call => call.startsWith('POST ')).length, 1);
  assert.equal(commands.filter(command => command.includes('KANDID_ANCHOR_SCHEDULER_ENABLED')).length, 6);
  assert.ok(commands.every(command => !/workflow run|variable set/.test(command)));
});
