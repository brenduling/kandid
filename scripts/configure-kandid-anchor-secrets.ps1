# Approved six-secret configuration. Run only in your trusted interactive terminal.
# Secret-write flow copied from the reviewed runbook; no scheduling or worker calls.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gh = $null
$node = $null
$secureInputs = New-Object 'System.Collections.Generic.List[System.Security.SecureString]'
$client = $null
$secrets = $null
$checkInput = $null
$diagnostic = @{ stage = 'local_setup'; reason = 'LOCAL_SETUP_FAILURE'; http_status = $null }
$writes = @{
    supabase_write_attempted = $false; supabase_writes_acknowledged = $false
    github_worker_write_attempted = $false; github_worker_write_acknowledged = $false
    github_gateway_write_attempted = $false; github_gateway_write_acknowledged = $false
}

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
        $diagnostic.reason = 'PROCESS_START_FAILURE'
        if (-not $process.Start()) { throw 'Stop.' }
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
        $diagnostic.reason = 'PROCESS_TIMEOUT'
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Stop.' }
        $discarded = $errTask.Result
        $diagnostic.reason = 'PROCESS_EXIT_FAILURE'
        if ($process.ExitCode -ne 0) { throw 'Stop.' }
        return $outTask.Result
    } finally { $process.Dispose() }
}

function Assert-SchedulerDisabled {
    Set-KandidStage $diagnostic 'github_scheduler'
    $state = Invoke-MemoryProcess $gh 'api repos/brenduling/kandid/actions/variables/KANDID_ANCHOR_SCHEDULER_ENABLED --jq .value' ''
    $diagnostic.reason = 'SCHEDULER_NOT_DISABLED'
    if ($state.Trim() -cne 'false') { throw 'Stop.' }
}

try {
    . (Join-Path $PSScriptRoot 'kandid-anchor-management.ps1')
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $gh = (Get-Command gh -ErrorAction Stop).Source
    $node = (Get-Command node -ErrorAction Stop).Source
    Assert-SchedulerDisabled
    Set-KandidStage $diagnostic 'github_target'
    $githubAccount = Invoke-MemoryProcess $gh 'api user --jq .login' ''
    $githubTarget = Invoke-MemoryProcess $gh 'api repos/brenduling/kandid --jq .full_name' ''
    $diagnostic.reason = 'GITHUB_TARGET_MISMATCH'
    if ($githubAccount.Trim() -cne 'brenduling' -or $githubTarget.Trim() -cne 'brenduling/kandid') { throw 'Stop.' }
    Set-KandidStage $diagnostic 'secure_input'
    $diagnostic.reason = 'SECURE_INPUT_FAILURE'
    $checkInput = @{
        privateKey = Read-PrivateText 'Original Sepolia private key (hidden)'
        rpcUrl = Read-PrivateText 'Original HTTPS Sepolia RPC URL (hidden)'
        gatewayJwt = Read-PrivateText 'Current project legacy anon JWT (hidden)'
        registryAddress = '0x91fB285801A80017Db3A5a75F0b797a2B4c4198A'
    }
    $checkJson = ConvertTo-Json -InputObject $checkInput -Compress
    $helper = '"' + (Join-Path $repo 'scripts\kandid-anchor-config-check.mjs') + '"'
    Set-KandidStage $diagnostic 'credential_verification'
    $verifiedJson = Invoke-MemoryProcess $node $helper $checkJson
    $diagnostic.reason = 'CREDENTIAL_VERIFICATION_FAILED'
    $verified = ConvertFrom-Json -InputObject $verifiedJson
    if (-not $verified.ok) { throw 'Stop.' }
    # Do not echo arbitrary helper output. The verifier can be run separately.

    Set-KandidStage $diagnostic 'worker_token_input'
    $diagnostic.reason = 'SECURE_INPUT_FAILURE'
    $workerToken = Read-PrivateText 'Single CSPRNG token (32+ random bytes), saved in password manager (hidden)'
    $diagnostic.reason = 'WORKER_TOKEN_INVALID'
    if ($workerToken -notmatch '^[A-Za-z0-9_+/=-]{43,}$') { throw 'Stop.' }
    Set-KandidStage $diagnostic 'management_token_input'
    $diagnostic.reason = 'SECURE_INPUT_FAILURE'
    $managementPat = Read-PrivateText 'Supabase operator Management API access token (hidden)'
    Set-KandidStage $diagnostic 'confirmation'
    $diagnostic.reason = 'CONFIRMATION_REQUIRED'
    if ((Read-Host 'Type CONFIGURE KANDID SECRETS after approval') -cne 'CONFIGURE KANDID SECRETS') { throw 'Stop.' }
    Assert-SchedulerDisabled

    $secrets = @(
        @{name='DEPLOYER_PRIVATE_KEY'; value=$checkInput.privateKey},
        @{name='SEPOLIA_RPC_URL'; value=$checkInput.rpcUrl},
        @{name='VOTE_REGISTRY_ADDRESS'; value=$checkInput.registryAddress},
        @{name='ANCHOR_WORKER_TOKEN'; value=$workerToken}
    )
    $secretJson = ConvertTo-Json -InputObject $secrets -Compress
    Set-KandidStage $diagnostic 'local_setup'
    $client = New-KandidManagementClient
    # Both reads must pass before any write; these are the same checks as the standalone preflight.
    foreach ($resource in @('project', 'secrets')) {
        $readCheck = Invoke-KandidManagementReadCheck -Client $client -Token $managementPat -Resource $resource
        if (-not $readCheck.ok) {
            $diagnostic.stage = $readCheck.stage
            $diagnostic.reason = $readCheck.reason
            $diagnostic.http_status = $readCheck.http_status
            throw 'Stop.'
        }
    }
    Assert-SchedulerDisabled
    Set-KandidStage $diagnostic 'supabase_secret_write'
    Invoke-KandidManagementRequest -Client $client -Method POST -Resource secrets -Token $managementPat -Body $secretJson -Diagnostic $diagnostic -Writes $writes

    Assert-SchedulerDisabled
    Set-KandidStage $diagnostic 'github_worker_write'
    $writes.github_worker_write_attempted = $true
    Invoke-MemoryProcess $gh 'secret set KANDID_ANCHOR_WORKER_TOKEN --repo brenduling/kandid' $workerToken | Out-Null
    $writes.github_worker_write_acknowledged = $true
    Assert-SchedulerDisabled
    Set-KandidStage $diagnostic 'github_gateway_write'
    $writes.github_gateway_write_attempted = $true
    Invoke-MemoryProcess $gh 'secret set KANDID_ANCHOR_GATEWAY_JWT --repo brenduling/kandid' $checkInput.gatewayJwt | Out-Null
    $writes.github_gateway_write_acknowledged = $true
    Set-KandidStage $diagnostic 'supabase_secret_list_read'
    $secretMetadata = @(Invoke-KandidManagementRequest -Client $client -Method GET -Resource secrets -Token $managementPat -Diagnostic $diagnostic)
    $requiredSupabaseNames = @('SEPOLIA_RPC_URL', 'DEPLOYER_PRIVATE_KEY', 'VOTE_REGISTRY_ADDRESS', 'ANCHOR_WORKER_TOKEN')
    $diagnostic.reason = 'SECRET_NAMES_MISSING'
    foreach ($name in $requiredSupabaseNames) { if (@($secretMetadata | Where-Object { $_.name -ceq $name }).Count -ne 1) { throw 'Stop.' } }
    Set-KandidStage $diagnostic 'github_secret_metadata'
    $githubNamesJson = Invoke-MemoryProcess $gh 'api repos/brenduling/kandid/actions/secrets --jq [.secrets[].name]' ''
    $diagnostic.reason = 'SECRET_METADATA_INVALID'
    $githubNames = ConvertFrom-Json -InputObject $githubNamesJson
    $requiredGithubNames = @('KANDID_ANCHOR_GATEWAY_JWT', 'KANDID_ANCHOR_WORKER_TOKEN')
    $diagnostic.reason = 'SECRET_NAMES_MISSING'
    foreach ($name in $requiredGithubNames) { if ($githubNames -cnotcontains $name) { throw 'Stop.' } }
    Assert-SchedulerDisabled
    [pscustomobject][ordered]@{
        ok = $true
        supabase_project = 'fszgdxqxonqqcrzsnkca'
        github_repository = 'brenduling/kandid'
        supabase_write_attempted = $writes.supabase_write_attempted
        supabase_writes_acknowledged = $writes.supabase_writes_acknowledged
        github_worker_write_attempted = $writes.github_worker_write_attempted
        github_worker_write_acknowledged = $writes.github_worker_write_acknowledged
        github_gateway_write_attempted = $writes.github_gateway_write_attempted
        github_gateway_write_acknowledged = $writes.github_gateway_write_acknowledged
        supabase_secret_names_verified = $requiredSupabaseNames
        github_secret_names_verified = $requiredGithubNames
        same_worker_token_input_used = $true
        scheduler_enabled = $false
        worker_invoked = $false
        runtime_authentication_verified = $false
    } | ConvertTo-Json -Depth 4
} catch {
    $safe = [pscustomobject]@{ stage = 'local_setup'; reason = 'LOCAL_SETUP_FAILURE'; http_status = $null }
    if (Get-Command Get-KandidSafeDiagnostic -ErrorAction SilentlyContinue) { $safe = Get-KandidSafeDiagnostic $diagnostic }
    [pscustomobject][ordered]@{
        ok = $false
        stage = $safe.stage
        reason = $safe.reason
        http_status = $safe.http_status
        supabase_write_attempted = $writes.supabase_write_attempted
        supabase_writes_acknowledged = $writes.supabase_writes_acknowledged
        github_worker_write_attempted = $writes.github_worker_write_attempted
        github_worker_write_acknowledged = $writes.github_worker_write_acknowledged
        github_gateway_write_attempted = $writes.github_gateway_write_attempted
        github_gateway_write_acknowledged = $writes.github_gateway_write_acknowledged
        write_outcome_unknown = (($writes.supabase_write_attempted -and -not $writes.supabase_writes_acknowledged) -or ($writes.github_worker_write_attempted -and -not $writes.github_worker_write_acknowledged) -or ($writes.github_gateway_write_attempted -and -not $writes.github_gateway_write_acknowledged))
        scheduler_state_requires_recheck = $true
        message = 'Stopped. Consult attempted and acknowledged flags; an unacknowledged attempted write may have completed. Retain canonical credentials securely.'
    } | ConvertTo-Json -Depth 4
    exit 1
} finally {
    if ($client) { $client.Dispose() }
    foreach ($secret in $secureInputs) { $secret.Dispose() }
    if ($checkInput) { $checkInput.Clear() }
    $secrets = $null
    $checkJson = $null
    $secretJson = $null
    $workerToken = $null
    $managementPat = $null
    $secretMetadata = $null
    $verifiedJson = $null
    $verified = $null
}
