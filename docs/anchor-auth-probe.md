# Anchoring worker authentication probe — local preparation

Official project: `fszgdxqxonqqcrzsnkca`. Repository: `brenduling/kandid`.
This is a new local worker revision, not a deployed change. Historical revision 5
and the exclusion-installation review manifest remain historical evidence.

## Request contract

Use **HEAD** on the existing URL:

`https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/anchor-ballot-hashes`

Required headers are unchanged:

- `Authorization: Bearer <canonical project legacy anon JWT>`
- `apikey: <same canonical legacy anon JWT>`
- `x-anchor-worker-token: <canonical worker token>`

The platform's `verify_jwt=true` check runs before the handler. The handler then
uses its existing worker-token check. Only after that check does HEAD return:

```http
HTTP/1.1 204 No Content
Cache-Control: no-store
X-Kandid-Anchor-Probe: ok
```

There is no body, credential echo, claim/role disclosure, server configuration
report, or log output. The probe reads only `ANCHOR_WORKER_TOKEN`; it exits before
reading the database URL, service-role key, RPC URL, private key, or registry setting.
It constructs no database client, provider, signer, or contract and makes no calls
to claims, leases, retries, reconciliation, or the blockchain. A pure ABI Interface
continues to be initialized at module load; it is not a network client.

Missing/wrong worker tokens still return 401, missing worker-token configuration
still returns 500, and invalid gateway JWTs must be rejected by the platform.
GET, OPTIONS, PUT, PATCH, and DELETE retain 405 at the handler. **POST remains the
normal anchoring path. Never use POST to test this probe, even with an auth-only
body, query parameter, or header. There is no fallback from HEAD to POST.**

The worker deliberately retains its existing platform JWT boundary; this change
does not add a different JWT verifier, client identity, or authorization policy.
See [Supabase authentication](https://supabase.com/docs/guides/functions/auth) and
[function configuration](https://supabase.com/docs/guides/functions/function-configuration).

## Validation and limits

`tests/anchorAuthProbe.test.mjs` executes the actual worker with forbidden-side-effect
spies. It checks the fixed response, no other environment reads or constructors,
missing/wrong tokens, unsupported methods, and repeated probes. A reconstruction
test removes exactly the two additions and verifies the entire prior worker against
its revision-5 normalized source hash. Existing POST success, failure, retry,
transaction persistence, reconciliation, receipt, scheduler, and exclusion tests
remain applicable.

Gateway rejection tests use synthetic HS256 credentials and an isolated cryptographic
gateway model. They are not a Supabase gateway emulator and do not establish hosted
JWT acceptance. Production JWT rejection is enforced by the unchanged deployed
`verify_jwt=true` configuration and must be checked after separately approved deployment.
The probe proves authentication only, not Sepolia connectivity, gas, signer ownership,
contract readiness, queue eligibility, or future anchoring success.

## Separate deployment approval required

1. Review `docs/anchor-auth-probe-manifest.json`, all source hashes, and test evidence.
   Confirm the production source still matches its recorded prior revision and the
   helper is unchanged. Confirm scheduling is exactly `false` with no outstanding run.
2. Read-only capture both excluded groups' preservation fingerprints and verify the
   durable exclusions/guards remain installed. No empty-queue assumption is needed
   for HEAD safety. Do not call claim RPCs to check queue state.
3. After explicit deployment approval, deploy **only** this worker from `kandid-clean`:

   ```powershell
   supabase functions deploy anchor-ballot-hashes --project-ref fszgdxqxonqqcrzsnkca
   ```

   Keep `[functions.anchor-ballot-hashes] verify_jwt = true`. Do not use
   `--no-verify-jwt`, deploy all functions, apply SQL, or change any secret. A connector
   deployment must likewise explicitly set `verify_jwt=true` and include only the
   reviewed worker and unchanged shared evidence helper.
4. Retrieve deployed source and require exact manifest hashes, ACTIVE status, and
   JWT verification enabled. Compare the other 12 functions with pre-deployment
   inventory. Stop on mismatch. **Do not invoke normal anchoring to validate deployment.**
5. Obtain separate approval for the three HEAD requests below. No GitHub workflow
   dispatch or scheduler activation is involved.

## Exact live-probe procedure — do not run before approval

Run the following only in the trusted Windows PowerShell 5.1 terminal after the
approved deployment has been verified. Use the securely retained canonical JWT
and worker token. Do not retrieve GitHub secret values, read unrelated .env files,
paste credentials into commands/chat, or use shell transcription/debug tracing.

First independently confirm the repository variable is exactly `false`:

```powershell
$state = & gh api repos/brenduling/kandid/actions/variables/KANDID_ANCHOR_SCHEDULER_ENABLED --jq .value
if ($LASTEXITCODE -ne 0 -or $state -cne 'false') { throw 'Stop: scheduler is not confirmed false.' }
```

Then run the three HEAD-only checks. The positive check must pass first. Fixed
negative controls independently verify gateway and worker-token rejection. Raw
responses, exceptions, credentials, and authorization headers are never printed.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $jwt = $null
    $workerToken = $null
    $client = $null
    function Read-HiddenText([string]$Prompt) {
        $secret = Read-Host $Prompt -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secret.Dispose()
        }
    }
    function Invoke-HeadProbe([string]$Bearer, [string]$Token) {
        $request = $null
        $response = $null
        try {
            $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Head,
                'https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/anchor-ballot-hashes')
            $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Bearer)
            $request.Headers.Add('apikey', $jwt)
            $request.Headers.Add('x-anchor-worker-token', $Token)
            $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            $marker = $false
            if ($response.Headers.Contains('X-Kandid-Anchor-Probe')) {
                $marker = (($response.Headers.GetValues('X-Kandid-Anchor-Probe') -join '') -ceq 'ok')
            }
            return [pscustomobject]@{ status = [int]$response.StatusCode; probe_marker = $marker }
        } finally {
            if ($response) { $response.Dispose() }
            if ($request) { $request.Dispose() }
        }
    }
    try {
        Add-Type -AssemblyName System.Net.Http
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $jwt = Read-HiddenText 'Canonical official-project legacy anon JWT (hidden)'
        $workerToken = Read-HiddenText 'Canonical worker token (hidden)'
        $handler = New-Object Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $client = New-Object Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(30)
        $positive = Invoke-HeadProbe $jwt $workerToken
        if ($positive.status -ne 204 -or -not $positive.probe_marker) { throw 'Stop.' }
        $badGateway = Invoke-HeadProbe 'invalid.fixture.token' $workerToken
        if ($badGateway.status -ne 401 -or $badGateway.probe_marker) { throw 'Stop.' }
        $invalidToken = 'invalid'
        if ($workerToken -ceq $invalidToken) { $invalidToken = 'invalid-2' }
        $badWorker = Invoke-HeadProbe $jwt $invalidToken
        if ($badWorker.status -ne 401 -or $badWorker.probe_marker) { throw 'Stop.' }
        [pscustomobject]@{
            gateway_authentication = 'PASS'
            worker_token_authentication = 'PASS'
            negative_controls = 'PASS'
            normal_anchoring_invoked = $false
        } | ConvertTo-Json
    } catch {
        Write-Output '{"ok":false,"reason":"AUTH_PROBE_FAILED","message":"Stop; raw diagnostics suppressed. No POST fallback is allowed."}'
    } finally {
        if ($client) { $client.Dispose() }
        $jwt = $null
        $workerToken = $null
    }
}
```

Finally recheck scheduler `false`, excluded fingerprints/statuses, leases, retries,
and transaction states using read-only queries. Stop after reporting results.
Do not activate scheduling as part of authentication verification.

Passing these checks verifies the supplied canonical credentials against production.
It does not read or prove the precise values stored in GitHub Actions secrets;
GitHub secret values are not retrievable. Testing those exact stored copies would
need a separately approved auth-only Actions procedure, never the normal worker job.

If deployment/probe verification fails, leave scheduling disabled and stop. Any
rollback deployment requires approval and the preserved revision-5 artifact/hash.
Exact prior worker/helper copies are retained locally under
`.tmp/anchor-auth-probe/revision5/`; the worker hash is
`32c76ed0e0262ccca129c0117f37193725afee6adeef03171dcdeee26b8d245c`.
Retain the production exclusion register and guards. No database migration, secret
change, contract change, or frontend deployment is required by this probe.
