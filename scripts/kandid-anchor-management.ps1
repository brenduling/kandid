# Shared, non-executing helpers. Never forward exception text or response bodies.
function New-KandidDiagnostic {
    return @{ stage = 'local_setup'; reason = 'LOCAL_SETUP_FAILURE'; http_status = $null }
}

function Set-KandidStage {
    param([hashtable]$Diagnostic, [string]$Stage)
    $Diagnostic.stage = $Stage
    $Diagnostic.reason = 'INTERNAL_FAILURE'
    $Diagnostic.http_status = $null
}

function Get-KandidSafeDiagnostic {
    param([hashtable]$Diagnostic)
    $stages = @('local_setup', 'github_scheduler', 'github_target', 'secure_input', 'credential_verification', 'worker_token_input', 'management_token_input', 'confirmation', 'supabase_project_read', 'supabase_secret_list_read', 'supabase_secret_write', 'github_worker_write', 'github_gateway_write', 'github_secret_metadata')
    $reasons = @('LOCAL_SETUP_FAILURE', 'INTERNAL_FAILURE', 'PROCESS_START_FAILURE', 'PROCESS_TIMEOUT', 'PROCESS_EXIT_FAILURE', 'SECURE_INPUT_FAILURE', 'CREDENTIAL_VERIFICATION_FAILED', 'WORKER_TOKEN_INVALID', 'MANAGEMENT_TOKEN_INVALID', 'CONFIRMATION_REQUIRED', 'SCHEDULER_NOT_DISABLED', 'GITHUB_TARGET_MISMATCH', 'HTTP_UNAUTHORIZED', 'HTTP_FORBIDDEN', 'HTTP_RATE_LIMITED', 'HTTP_REDIRECT', 'HTTP_ERROR', 'REQUEST_TIMEOUT', 'DNS_FAILURE', 'TLS_FAILURE', 'NETWORK_FAILURE', 'INVALID_JSON_RESPONSE', 'PROJECT_RESPONSE_INVALID', 'PROJECT_MISMATCH', 'PROJECT_NOT_HEALTHY', 'SECRET_METADATA_INVALID', 'SECRET_NAMES_MISSING')
    $stage = 'local_setup'
    $reason = 'INTERNAL_FAILURE'
    if ($stages -ccontains $Diagnostic.stage) { $stage = $Diagnostic.stage }
    if ($reasons -ccontains $Diagnostic.reason) { $reason = $Diagnostic.reason }
    $status = $null
    if ($Diagnostic.http_status -is [int] -and $Diagnostic.http_status -ge 100 -and $Diagnostic.http_status -le 599) { $status = $Diagnostic.http_status }
    return [pscustomobject]@{ stage = $stage; reason = $reason; http_status = $status }
}

function New-KandidManagementClient {
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    # HttpClient owns and disposes its handler. Certificate validation is unchanged.
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    return $client
}

function Invoke-KandidManagementRequest {
    param(
        [object]$Client,
        [ValidateSet('GET', 'POST')][string]$Method,
        [ValidateSet('project', 'secrets')][string]$Resource,
        [string]$Token,
        [hashtable]$Diagnostic,
        [string]$Body,
        [hashtable]$Writes
    )
    $request = $null
    $response = $null
    try {
        # Fixed origin and project; no caller-supplied URL or redirect following.
        $url = 'https://api.supabase.com/v1/projects/fszgdxqxonqqcrzsnkca'
        if ($Resource -ceq 'secrets') { $url += '/secrets' }
        if ($Method -ceq 'POST' -and ($Resource -cne 'secrets' -or $null -eq $Writes)) { throw 'Stop.' }
        $Diagnostic.reason = 'MANAGEMENT_TOKEN_INVALID'
        if ([string]::IsNullOrWhiteSpace($Token) -or $Token -match '\s') { throw 'Stop.' }
        $request = New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod($Method)), $url)
        $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
        if ($Method -ceq 'POST') { $request.Content = New-Object Net.Http.StringContent($Body, [Text.Encoding]::UTF8, 'application/json') }
        $Diagnostic.reason = 'NETWORK_FAILURE'
        if ($Method -ceq 'POST') { $Writes.supabase_write_attempted = $true }
        try {
            # A successful write is acknowledged on headers; no write response body is needed.
            $completion = [Net.Http.HttpCompletionOption]::ResponseContentRead
            if ($Method -ceq 'POST') { $completion = [Net.Http.HttpCompletionOption]::ResponseHeadersRead }
            $response = $Client.SendAsync($request, $completion).GetAwaiter().GetResult()
        } catch {
            $exception = $_.Exception
            while ($null -ne $exception) {
                if ($exception -is [OperationCanceledException]) { $Diagnostic.reason = 'REQUEST_TIMEOUT'; break }
                if ($exception -is [Security.Authentication.AuthenticationException]) { $Diagnostic.reason = 'TLS_FAILURE'; break }
                if ($exception -is [Net.Sockets.SocketException] -and $exception.SocketErrorCode -in @([Net.Sockets.SocketError]::HostNotFound, [Net.Sockets.SocketError]::NoData)) { $Diagnostic.reason = 'DNS_FAILURE'; break }
                $exception = $exception.InnerException
            }
            throw 'Stop.'
        }
        $Diagnostic.http_status = [int]$response.StatusCode
        if (-not $response.IsSuccessStatusCode) {
            $Diagnostic.reason = switch ([int]$response.StatusCode) {
                401 { 'HTTP_UNAUTHORIZED' }
                403 { 'HTTP_FORBIDDEN' }
                429 { 'HTTP_RATE_LIMITED' }
                { $_ -ge 300 -and $_ -lt 400 } { 'HTTP_REDIRECT' }
                default { 'HTTP_ERROR' }
            }
            throw 'Stop.'
        }
        if ($Method -ceq 'POST') {
            $Writes.supabase_writes_acknowledged = $true
            return
        }
        $Diagnostic.reason = 'NETWORK_FAILURE'
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $Diagnostic.reason = 'INVALID_JSON_RESPONSE'
        # Secret metadata is consumed privately. Only selected names leave read checks.
        $parsed = ConvertFrom-Json -InputObject $content -ErrorAction Stop
        if ($Resource -ceq 'secrets' -and -not $content.TrimStart().StartsWith('[')) { throw 'Stop.' }
        return $parsed
    } finally {
        if ($response) { $response.Dispose() }
        if ($request) { $request.Dispose() }
        $content = $null
        $parsed = $null
    }
}

function Invoke-KandidManagementReadCheck {
    param([object]$Client, [string]$Token, [ValidateSet('project', 'secrets')][string]$Resource)
    $diagnostic = New-KandidDiagnostic
    $permission = 'project_admin_read'
    $stage = 'supabase_project_read'
    if ($Resource -ceq 'secrets') { $permission = 'edge_functions_secrets_read'; $stage = 'supabase_secret_list_read' }
    Set-KandidStage $diagnostic $stage
    $access = $null
    $names = @()
    try {
        $data = @(Invoke-KandidManagementRequest -Client $Client -Method GET -Resource $Resource -Token $Token -Diagnostic $diagnostic)
        $access = $true
        if ($Resource -ceq 'project') {
            $diagnostic.reason = 'PROJECT_RESPONSE_INVALID'
            if ($data.Count -ne 1 -or $null -eq $data[0].PSObject.Properties['id'] -or $null -eq $data[0].PSObject.Properties['status']) { throw 'Stop.' }
            $diagnostic.reason = 'PROJECT_MISMATCH'
            if ($data[0].id -cne 'fszgdxqxonqqcrzsnkca') { throw 'Stop.' }
            $diagnostic.reason = 'PROJECT_NOT_HEALTHY'
            if ($data[0].status -cne 'ACTIVE_HEALTHY') { throw 'Stop.' }
        } else {
            $diagnostic.reason = 'SECRET_METADATA_INVALID'
            foreach ($entry in $data) {
                if ($null -eq $entry -or $null -eq $entry.PSObject.Properties['name'] -or $entry.name -isnot [string]) { throw 'Stop.' }
            }
            foreach ($name in @('SEPOLIA_RPC_URL', 'DEPLOYER_PRIVATE_KEY', 'VOTE_REGISTRY_ADDRESS', 'ANCHOR_WORKER_TOKEN')) {
                if (@($data | Where-Object { $_.name -ceq $name }).Count -gt 1) { throw 'Stop.' }
                if (@($data | Where-Object { $_.name -ceq $name }).Count -eq 1) { $names += $name }
            }
        }
        return [pscustomobject]@{ ok = $true; stage = $stage; reason = $null; http_status = $diagnostic.http_status; access_granted = $true; required_permission = $permission; approved_secret_names_present = $names }
    } catch {
        if ($diagnostic.http_status -in @(401, 403)) { $access = $false }
        $safe = Get-KandidSafeDiagnostic $diagnostic
        return [pscustomobject]@{ ok = $false; stage = $safe.stage; reason = $safe.reason; http_status = $safe.http_status; access_granted = $access; required_permission = $permission; approved_secret_names_present = @() }
    } finally { $data = $null }
}
