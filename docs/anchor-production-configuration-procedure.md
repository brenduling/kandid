# Kandid anchoring: secure configuration procedure for review

Prepared locally only. None of the commands that configure secrets have been run.
Target: Supabase `fszgdxqxonqqcrzsnkca`, GitHub `brenduling/kandid`.
Keep `KANDID_ANCHOR_SCHEDULER_ENABLED` exactly `false` for the entire procedure.
Do not dispatch Actions or call the worker, including for a supposed dry run.

## 1. Credentials and public bindings

| Location | Name | Trusted source |
| --- | --- | --- |
| Supabase Edge Function secrets | `DEPLOYER_PRIVATE_KEY` | Existing original wallet key in secure local storage; do not create another wallet |
| Supabase Edge Function secrets | `SEPOLIA_RPC_URL` | Existing HTTPS RPC URL in secure local storage |
| Supabase Edge Function secrets | `VOTE_REGISTRY_ADDRESS` | Reviewed public address below |
| Supabase Edge Function secrets | `ANCHOR_WORKER_TOKEN` | One canonical token saved in your password manager |
| GitHub repository Actions secrets | `KANDID_ANCHOR_WORKER_TOKEN` | Exactly the same canonical token |
| GitHub repository Actions secrets | `KANDID_ANCHOR_GATEWAY_JWT` | Current project's legacy **anon HS256 JWT**, from trusted storage or the project's API Keys dashboard |

Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Preserve them;
do not recreate them or copy them to GitHub. The legacy fallback
`VITE_VOTE_REGISTRY_ADDRESS` is unnecessary when `VOTE_REGISTRY_ADDRESS` is set.
No signer, RPC, or worker secrets belong in browser `VITE_*` variables.

Reviewed public bindings:

- Sepolia chain ID: `11155111`.
- Registry: `0x91fB285801A80017Db3A5a75F0b797a2B4c4198A`.
- Reviewed owner: `0x70d276359a4249d49E6302106171378D99C5db3F`.
- Registry runtime SHA-256: `e2931cc609f100b8c21856a4134bba21ae82161b5598792b134c524d37f34f26`.
- Worker revision-5 source SHA-256: `32c76ed0e0262ccca129c0117f37193725afee6adeef03171dcdeee26b8d245c`.
- Reviewed workflow Git blob: `80e1b6c6dfe92c6983e8397b5be2624de04b04f0`.

## 2. Verify the trusted local credentials, without changing configuration

Use a fresh Windows PowerShell 5.1 terminal on your trusted machine, outside a
recorded/transcribed/debug session. Node.js and Kandid's existing `ethers`
dependency must already be installed. No package installation is needed.

```powershell
Set-Location -LiteralPath 'C:\Users\Mariel\OneDrive\Desktop\kandid-clean'
& .\scripts\verify-kandid-anchor-config.ps1
```

The three hidden prompts ask for your original wallet key, original HTTPS RPC
URL, and the project's current legacy anon JWT. Use password-manager autofill
or secure paste directly into the hidden prompt. Never type credentials as
command arguments, set them in environment variables, or put them in a file.
If using the clipboard, clear it and clipboard history afterward.

The script passes inputs through a local process stdin pipe. It does not read
`.env`, save credentials, print RPC URLs, report raw exceptions, or contact the
worker. An offline wallet derives only the public signer address. The RPC calls
are exclusively `eth_chainId`, `eth_getCode`, `eth_call` for `owner()`,
`eth_getBalance`, and `eth_getTransactionCount`.

Required results:

1. Chain ID is 11155111 and the fixed reviewed registry has matching runtime code.
2. Derived signer equals both the reviewed owner and the live contract's owner.
3. Signer balance meets the worker's conservative 0.001 ETH minimum; pending and
   latest signer nonces match. This is not an estimate of every future gas cost;
   the worker retains its per-ballot gas-cost check before broadcasting.
4. JWT has `alg=HS256`, `role=anon`, `ref=fszgdxqxonqqcrzsnkca`, and expiration more
   than one minute in the future. The report shows the expiration date only.
5. A GET to this project's `/auth/v1/settings`, using the supplied credential in
   headers, succeeds. Response bodies and headers are not printed. This checks
   project API-key acceptance; it does **not** prove the Edge Function gateway's
   JWT path or the worker's private-token check.

Stop on any failure. The default verifier cannot change secrets or send a chain
transaction. Nothing here proves what is currently stored inside either platform.
Failures now return only an allowlisted JSON diagnostic: `stage`, `reason`, a
fixed explanation, and `stopped_before_configuration=true`, with exit code 1.
For example, `rpc_chain` plus `HTTP_UNAUTHORIZED` identifies RPC authentication,
while `project_api_key_acceptance` plus the same reason identifies Supabase API
authentication. `JWT_EXPIRED_OR_NEAR_EXPIRY` identifies expiration locally;
`HELPER_STARTUP_FAILED` identifies missing structured Node output, commonly a
runtime/dependency issue. HTTP bodies, URLs, provider messages, stderr, and
exception details remain suppressed. Do not disable certificate validation for
`TLS_FAILURE`, or bypass any failed check. Only the safe JSON report is suitable
for review; never share inputs or a raw diagnostic capture.

Plaintext exists transiently in process memory to derive addresses and make HTTPS
requests; SecureString and clearing references cannot guarantee erasure of all
managed-memory copies. Close the verification terminal when finished.

## 3. Approval gate: re-establish production secrets

Do not run this section until configuration changes are separately approved.
It uses the **same in-memory values** for validation and provisioning, and the
same worker-token variable for both platforms. Supabase secrets are project-wide,
so only the four named custom secrets are upserted. No reserved variables,
function sources, contract, workflow, ballot, or election records are changed.

Use the existing canonical token if you have it in secure storage. Otherwise,
after rotation approval, generate one cryptographically random token with at least
32 random bytes in your password manager and save it there once. Do not generate
it twice for the two platforms. The commands below never generate or print it.

An operator Supabase Management API personal access token is also needed for this
step, entered through a hidden prompt. It is temporary operator authorization,
not a worker secret, and must never be saved to GitHub or the worker environment.
If you lack that authorization, stop; do not substitute a service-role key.

Review this PowerShell 5.1 block before later approved execution. It uses a
memory-only HTTPS body for Supabase and stdin for GitHub CLI; there are no secret
arguments, secret files, environment exports, or raw response/error logs.

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'C:\Users\Mariel\OneDrive\Desktop\kandid-clean'
$gh = (Get-Command gh -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$secureInputs = New-Object 'System.Collections.Generic.List[System.Security.SecureString]'
$client = $null
$handler = $null
$request = $null
$response = $null
$secrets = $null
$checkInput = $null

function Read-PrivateText {
    param([string]$Prompt)
    $secret = Read-Host $Prompt -AsSecureString
    $secureInputs.Add($secret)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-MemoryProcess {
    param([string]$Executable, [string]$Arguments, [string]$InputText)
    $process = New-Object Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Executable
        $process.StartInfo.Arguments = $Arguments # Only public, fixed arguments
        $process.StartInfo.WorkingDirectory = $repo
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardInput = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        if (-not $process.Start()) { throw 'Private process failed.' }
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Private process timed out.' }
        $discarded = $errTask.Result
        if ($process.ExitCode -ne 0) { throw 'Private process failed; diagnostics suppressed.' }
        return $outTask.Result
    } finally { $process.Dispose() }
}

function Assert-SchedulerDisabled {
    $state = Invoke-MemoryProcess $gh 'api repos/brenduling/kandid/actions/variables/KANDID_ANCHOR_SCHEDULER_ENABLED --jq .value' ''
    if ($state.Trim() -cne 'false') { throw 'Scheduler must be exactly false.' }
}

try {
    Assert-SchedulerDisabled
    $checkInput = @{
        privateKey = Read-PrivateText 'Original Sepolia private key (hidden)'
        rpcUrl = Read-PrivateText 'Original HTTPS Sepolia RPC URL (hidden)'
        gatewayJwt = Read-PrivateText 'Current project legacy anon JWT (hidden)'
        registryAddress = '0x91fB285801A80017Db3A5a75F0b797a2B4c4198A'
    }
    $checkJson = ConvertTo-Json -InputObject $checkInput -Compress
    $helper = '"' + (Join-Path $repo 'scripts\kandid-anchor-config-check.mjs') + '"'
    $verified = (Invoke-MemoryProcess $node $helper $checkJson) | ConvertFrom-Json
    if (-not $verified.ok) { throw 'Trusted credential verification failed.' }
    $verified | ConvertTo-Json -Depth 4 # Public addresses and safe flags only

    $workerToken = Read-PrivateText 'Single canonical worker token from password manager (hidden)'
    if ($workerToken -notmatch '^[A-Za-z0-9_+/=-]{43,}$') { throw 'Worker token is invalid; use the saved random ASCII token without whitespace.' }
    $managementPat = Read-PrivateText 'Supabase operator Management API access token (hidden)'
    if ((Read-Host 'Type CONFIGURE KANDID SECRETS after approval') -cne 'CONFIGURE KANDID SECRETS') { throw 'Not confirmed.' }
    Assert-SchedulerDisabled

    $secrets = @(
        @{name='DEPLOYER_PRIVATE_KEY'; value=$checkInput.privateKey},
        @{name='SEPOLIA_RPC_URL'; value=$checkInput.rpcUrl},
        @{name='VOTE_REGISTRY_ADDRESS'; value=$checkInput.registryAddress},
        @{name='ANCHOR_WORKER_TOKEN'; value=$workerToken}
    )
    $secretJson = ConvertTo-Json -InputObject $secrets -Compress
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, 'https://api.supabase.com/v1/projects/fszgdxqxonqqcrzsnkca/secrets')
    $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $managementPat)
    $request.Content = New-Object Net.Http.StringContent($secretJson, [Text.Encoding]::UTF8, 'application/json')
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw 'Supabase secret update failed; response suppressed.' }

    Assert-SchedulerDisabled
    Invoke-MemoryProcess $gh 'secret set KANDID_ANCHOR_WORKER_TOKEN --repo brenduling/kandid' $workerToken | Out-Null
    Invoke-MemoryProcess $gh 'secret set KANDID_ANCHOR_GATEWAY_JWT --repo brenduling/kandid' $checkInput.gatewayJwt | Out-Null
    Assert-SchedulerDisabled
    'Secret writes acknowledged; scheduler remains false. Runtime authentication remains untested.'
} catch {
    throw 'Stopped. Keep scheduler false. A secret write may have partially completed; retain canonical credentials securely and inspect only safe metadata. Raw diagnostics suppressed.'
} finally {
    if ($response) { $response.Dispose() }
    if ($request) { $request.Dispose() }
    if ($client) { $client.Dispose() }
    if ($handler) { $handler.Dispose() }
    foreach ($secret in $secureInputs) { $secret.Dispose() }
    if ($checkInput) { $checkInput.Clear() }
    $secrets = $null
    $checkJson = $null
    $secretJson = $null
    $workerToken = $null
    $managementPat = $null
}
```

Do not enable PowerShell transcripts, debug tracing, shell command echoing, HTTP
debug logging, or process dumps while credentials are in memory. Do not send the
PowerShell session, input, response bodies, secret digests, or process stderr to
chat. Store only the safe verifier result and acknowledgement in your change log.

## 4. What the evidence establishes

| Binding | Evidence | Limit |
| --- | --- | --- |
| Trusted wallet -> signer -> registry owner | Offline address derivation plus public `owner()` | No private key is sent to the RPC |
| Trusted RPC -> Sepolia | `eth_chainId=11155111` from the actual supplied URL | Trust the original endpoint; this is not proof about an untouched stored production URL |
| Reviewed registry -> contract | Fixed address, chain, runtime hash, owner | No contract deployment or ownership transfer |
| Supplied JWT -> intended project/expiry | Claims plus successful project API-key GET | Claims alone do not verify a signature; Auth API acceptance does not test Edge JWT enforcement |
| Validated inputs -> production configuration | Approved Supabase upsert sends exactly the validated values | Acknowledgement is configuration evidence, not proof of runtime environment propagation |
| One worker token -> both platforms | One in-memory value sent to both APIs; success acknowledgements | GitHub secrets cannot be read back for independent equality comparison |
| Supplied JWT -> GitHub | Same validated JWT sent through CLI stdin | Cannot retrieve GitHub's stored value to independently compare it |
| GitHub -> Edge gateway -> worker -> queue | Not tested by this procedure | An authenticated production invocation would be required; real-token worker calls can process ballots immediately |

## 5. After later approved configuration, stop again

Recheck the variable is false, secret names/update metadata, worker status/JWT
setting and reviewed source hashes, workflow blob, pending ballots, leases, and
public chain state. Do not run Actions or the worker as a configuration probe.
No redeployment is planned: Supabase documents that secret updates become
available without redeploying functions. Obtain separate activation approval;
configuration approval does not activate the scheduler.

If either platform's write fails, leave scheduling disabled. Retain the canonical
token in secure storage and complete/repeat only the approved failed writes using
the same value. Revert only to previously retained, known-good credentials if an
explicit rollback is approved. Never delete secrets or replace them with empty
values to undo a partial write. Changing these secrets does not change existing
ballots, hashes, or contract data; it cannot undo a prior blockchain broadcast.

## References

- [Supabase production function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Studio's official secret-upsert implementation](https://github.com/supabase/supabase/blob/master/apps/studio/data/secrets/secrets-create-mutation.ts)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Auth API](https://github.com/supabase/auth/blob/master/openapi.yaml)
- [GitHub CLI secret set: stdin support and local encryption](https://cli.github.com/manual/gh_secret_set)
