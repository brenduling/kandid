[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$helper = Join-Path $PSScriptRoot 'kandid-anchor-config-check.mjs'
$node = $null
$secureInputs = @()
$payload = $null
$payloadJson = $null
$child = $null
$failure = $null
$failureStage = 'powershell_setup'
$failureReason = 'LOCAL_SETUP_FAILURE'
$safeResult = $null

function Get-SafeVerificationFailure {
    param([object]$Result, [string]$FallbackStage = 'helper_response', [string]$FallbackReason = 'HELPER_OUTPUT_INVALID')
    $stages = @('powershell_setup', 'secure_input', 'process_start', 'process_input', 'process_wait', 'helper_response', 'input', 'gateway_claims', 'local_signer', 'rpc_chain', 'registry_code', 'signer_owner', 'signer_funding', 'signer_nonce', 'project_api_key_acceptance')
    $reasons = @{
        LOCAL_SETUP_FAILURE = 'Local PowerShell or .NET setup failed.'
        NODE_NOT_FOUND = 'Node.js is unavailable in this terminal.'
        HELPER_NOT_FOUND = 'The local Node verification helper is missing.'
        SECURE_INPUT_FAILURE = 'The hidden credential input could not be collected.'
        HELPER_START_FAILURE = 'The local Node helper could not be started.'
        PIPE_WRITE_FAILURE = 'The private input pipe could not be written.'
        HELPER_TIMEOUT = 'The local helper exceeded its time limit.'
        HELPER_STARTUP_FAILED = 'Node emitted no structured result; check Node version and the installed ethers dependency.'
        HELPER_OUTPUT_INVALID = 'The local helper did not return a recognized diagnostic or result.'
        HELPER_EXIT_FAILURE = 'The helper exited unsuccessfully despite reporting success.'
        NODE_RUNTIME_UNSUPPORTED = 'Node must support fetch and AbortSignal.timeout.'
        INPUT_FIELDS_MISSING = 'One or more required credential inputs are missing.'
        INPUT_JSON_INVALID = 'The private input pipe did not contain valid JSON.'
        INPUT_TOO_LARGE = 'The private input exceeded the allowed size.'
        RPC_URL_INVALID = 'The RPC URL is not a valid URL.'
        RPC_URL_UNSAFE = 'The RPC URL must use HTTPS without URL user-info or a fragment.'
        REGISTRY_ADDRESS_INVALID = 'The registry address is malformed.'
        REGISTRY_ADDRESS_MISMATCH = 'The registry address differs from the reviewed address.'
        JWT_FORMAT_INVALID = 'The gateway credential is not a three-part JWT.'
        JWT_JSON_INVALID = 'The JWT header or claims cannot be decoded as JSON objects.'
        JWT_ALGORITHM_MISMATCH = 'The JWT algorithm must be HS256.'
        JWT_ROLE_MISMATCH = 'The JWT role must be anon.'
        JWT_PROJECT_MISMATCH = 'The JWT project reference differs from the official project.'
        JWT_EXPIRATION_INVALID = 'The JWT expiration is missing or invalid.'
        JWT_EXPIRED_OR_NEAR_EXPIRY = 'The JWT is expired or expires within one minute.'
        PRIVATE_KEY_INVALID = 'The supplied key could not derive an offline Ethereum signer.'
        REQUEST_TIMEOUT = 'The HTTPS request timed out.'
        DNS_FAILURE = 'The HTTPS endpoint could not be resolved.'
        TLS_FAILURE = 'TLS certificate validation failed; do not disable certificate validation.'
        NETWORK_FAILURE = 'The HTTPS request failed; endpoint details are suppressed.'
        HTTP_UNAUTHORIZED = 'The endpoint rejected authentication (HTTP 401).'
        HTTP_FORBIDDEN = 'The endpoint refused access (HTTP 403).'
        HTTP_RATE_LIMITED = 'The endpoint rate limit was reached (HTTP 429).'
        HTTP_REDIRECT = 'An HTTP redirect was rejected.'
        HTTP_ERROR = 'The endpoint returned an unexpected HTTP status.'
        INVALID_JSON_RESPONSE = 'The endpoint did not return valid JSON.'
        RPC_METHOD_UNAVAILABLE = 'The RPC endpoint does not support a required read-only method.'
        RPC_PARAMETERS_REJECTED = 'The RPC endpoint rejected the request parameters.'
        RPC_ERROR = 'The RPC returned an error; its message and data are suppressed.'
        RPC_RESPONSE_INVALID = 'The RPC response is missing a result or has an unexpected request ID.'
        RPC_QUANTITY_INVALID = 'The RPC returned an invalid hexadecimal quantity.'
        CHAIN_ID_MISMATCH = 'The RPC endpoint does not report Sepolia chain 11155111.'
        REGISTRY_CODE_MISSING = 'No contract code exists at the reviewed registry address.'
        REGISTRY_CODE_INVALID = 'The RPC returned malformed registry bytecode.'
        REGISTRY_RUNTIME_MISMATCH = 'The registry runtime differs from the reviewed contract.'
        OWNER_RESPONSE_INVALID = 'The registry owner response could not be decoded.'
        REVIEWED_OWNER_MISMATCH = 'The contract owner differs from the reviewed owner.'
        SIGNER_OWNER_MISMATCH = 'The local signer is not the contract owner.'
        SIGNER_BALANCE_INSUFFICIENT = 'The signer balance is below the required 0.001 ETH minimum.'
        SIGNER_PENDING_TRANSACTIONS = 'The signer pending and confirmed nonces differ.'
        AUTH_SETTINGS_RESPONSE_INVALID = 'Supabase returned an unexpected Auth settings response.'
        INTERNAL_FAILURE = 'An unexpected local failure occurred; raw diagnostics are suppressed.'
    }
    $stage = 'helper_response'
    $reason = 'HELPER_OUTPUT_INVALID'
    if ($stages -ccontains $FallbackStage -and $reasons.ContainsKey($FallbackReason)) {
        $stage = $FallbackStage
        $reason = $FallbackReason
    }
    # Ignore helper messages, URLs, status bodies, and unknown diagnostic values.
    if ($null -ne $Result) {
        $stageProperty = $Result.PSObject.Properties['stage']
        $reasonProperty = $Result.PSObject.Properties['reason']
        if ($null -ne $stageProperty -and $null -ne $reasonProperty -and
            $stageProperty.Value -is [string] -and $reasonProperty.Value -is [string] -and
            $stages -ccontains $stageProperty.Value -and $reasons.ContainsKey($reasonProperty.Value)) {
            $stage = $stageProperty.Value
            $reason = $reasonProperty.Value
        }
    }
    return [pscustomobject][ordered]@{ ok = $false; stage = $stage; reason = $reason; message = $reasons[$reason]; stopped_before_configuration = $true }
}

function Read-PrivateInput {
    param([string]$Prompt)
    $secret = Read-Host $Prompt -AsSecureString
    $script:secureInputs += $secret
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

try {
    $failureReason = 'NODE_NOT_FOUND'
    $node = (Get-Command node -ErrorAction Stop).Source
    $failureReason = 'HELPER_NOT_FOUND'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Stop.' }
    $failureStage = 'secure_input'
    $failureReason = 'SECURE_INPUT_FAILURE'
    $payload = @{
        privateKey = Read-PrivateInput 'Existing Sepolia wallet private key (hidden)'
        rpcUrl = Read-PrivateInput 'Existing HTTPS Sepolia RPC URL (hidden)'
        gatewayJwt = Read-PrivateInput 'Current project legacy anon JWT from trusted storage/dashboard (hidden)'
        registryAddress = '0x91fB285801A80017Db3A5a75F0b797a2B4c4198A'
    }
    $payloadJson = ConvertTo-Json -InputObject $payload -Compress
    $failureStage = 'process_start'
    $failureReason = 'HELPER_START_FAILURE'
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $node
    $start.Arguments = '"' + $helper + '"'
    $start.WorkingDirectory = $repo
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $start
    if (-not $child.Start()) { throw 'Unable to start local verifier.' }
    $stdoutTask = $child.StandardOutput.ReadToEndAsync()
    $stderrTask = $child.StandardError.ReadToEndAsync()
    # Credentials travel only through a local pipe, never argv, env, or files.
    $failureStage = 'process_input'
    $failureReason = 'PIPE_WRITE_FAILURE'
    $child.StandardInput.Write($payloadJson)
    $child.StandardInput.Close()
    $failureStage = 'process_wait'
    $failureReason = 'HELPER_TIMEOUT'
    if (-not $child.WaitForExit(180000)) {
        $child.Kill()
        throw 'Local verification timed out; no raw diagnostic output was displayed.'
    }
    $failureStage = 'helper_response'
    $failureReason = 'HELPER_OUTPUT_INVALID'
    $output = $stdoutTask.GetAwaiter().GetResult()
    $stderrTask.GetAwaiter().GetResult() | Out-Null
    if ([string]::IsNullOrWhiteSpace($output)) {
        $failureReason = 'HELPER_STARTUP_FAILED'
        throw 'Stop.'
    }
    $result = $output | ConvertFrom-Json
    if ($null -eq $result -or $null -eq $result.PSObject.Properties['ok'] -or $result.ok -isnot [bool]) { throw 'Stop.' }
    if (-not $result.ok) {
        $failure = Get-SafeVerificationFailure -Result $result
        throw 'Stop.'
    }
    if ($child.ExitCode -ne 0) {
        $failureReason = 'HELPER_EXIT_FAILURE'
        throw 'Stop.'
    }
    $fields = @('ok', 'chain_id', 'registry', 'registry_runtime_matches_review', 'signer_address', 'contract_owner', 'signer_matches_owner', 'signer_balance_eth', 'minimum_balance_check', 'pending_nonce_matches_latest', 'gateway_project_claim_matches', 'gateway_role', 'gateway_algorithm', 'gateway_expires_at', 'project_api_key_accepted', 'edge_worker_authentication_tested', 'production_secret_values_verified')
    foreach ($field in $fields) { if ($null -eq $result.PSObject.Properties[$field]) { throw 'Stop.' } }
    foreach ($field in @('registry_runtime_matches_review', 'signer_matches_owner', 'minimum_balance_check', 'pending_nonce_matches_latest', 'gateway_project_claim_matches', 'project_api_key_accepted')) {
        if ($result.$field -isnot [bool] -or -not $result.$field) { throw 'Stop.' }
    }
    foreach ($field in @('edge_worker_authentication_tested', 'production_secret_values_verified')) {
        if ($result.$field -isnot [bool] -or $result.$field) { throw 'Stop.' }
    }
    if ($result.chain_id -ne 11155111 -or
        $result.registry -cne '0x91fB285801A80017Db3A5a75F0b797a2B4c4198A' -or
        $result.signer_address -cne '0x70d276359a4249d49E6302106171378D99C5db3F' -or
        $result.contract_owner -cne $result.signer_address -or
        $result.gateway_role -cne 'anon' -or $result.gateway_algorithm -cne 'HS256' -or
        [string]$result.signer_balance_eth -cnotmatch '^\d+(\.\d+)?$' -or
        [string]$result.gateway_expires_at -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'Stop.' }
    # Print only the recognized, validated public result fields.
    $safeResult = $result | Select-Object -Property $fields
} catch {
    if ($null -eq $failure) { $failure = Get-SafeVerificationFailure -FallbackStage $failureStage -FallbackReason $failureReason }
} finally {
    if ($child) { try { $child.Dispose() } catch {} }
    foreach ($secret in $secureInputs) { $secret.Dispose() }
    if ($payload) { $payload.Clear() }
    $payloadJson = $null
    $secureInputs = @()
    $output = $null
    $result = $null
    $stdoutTask = $null
    $stderrTask = $null
}

if ($null -ne $failure) {
    $failure | ConvertTo-Json -Depth 4
    exit 1
}
$safeResult | ConvertTo-Json -Depth 4
