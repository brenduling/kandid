# Read-only Management API preflight. No GitHub calls or write methods.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$secureToken = $null
$token = $null
$client = $null
$diagnostic = @{ stage = 'local_setup'; reason = 'LOCAL_SETUP_FAILURE'; http_status = $null }
try {
    . (Join-Path $PSScriptRoot 'kandid-anchor-management.ps1')
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Set-KandidStage $diagnostic 'management_token_input'
    $diagnostic.reason = 'SECURE_INPUT_FAILURE'
    $secureToken = Read-Host 'Supabase Management API token for the official project (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Set-KandidStage $diagnostic 'local_setup'
    $client = New-KandidManagementClient
    # Independently check both permissions, including when the project GET is denied.
    $project = Invoke-KandidManagementReadCheck -Client $client -Token $token -Resource project
    $metadata = Invoke-KandidManagementReadCheck -Client $client -Token $token -Resource secrets
    $ok = $project.ok -and $metadata.ok
    [pscustomobject][ordered]@{
        ok = [bool]$ok
        supabase_project = 'fszgdxqxonqqcrzsnkca'
        read_only = $true
        project_check = $project
        secret_metadata_check = $metadata
        required_read_permissions_verified = ($project.access_granted -eq $true -and $metadata.access_granted -eq $true)
        write_permission_verified = $false
        stored_secret_values_verified = $false
        write_attempted = $false
        worker_invoked = $false
    } | ConvertTo-Json -Depth 5
    if (-not $ok) { exit 1 }
} catch {
    # Also sanitize failures before the shared helper can be loaded.
    $safe = [pscustomobject]@{ stage = 'local_setup'; reason = 'LOCAL_SETUP_FAILURE'; http_status = $null }
    if (Get-Command Get-KandidSafeDiagnostic -ErrorAction SilentlyContinue) { $safe = Get-KandidSafeDiagnostic $diagnostic }
    [pscustomobject]@{ ok = $false; stage = $safe.stage; reason = $safe.reason; http_status = $safe.http_status; read_only = $true; required_read_permissions_verified = $false; write_permission_verified = $false; write_attempted = $false } | ConvertTo-Json
    exit 1
} finally {
    if ($client) { $client.Dispose() }
    if ($secureToken) { $secureToken.Dispose() }
    $token = $null
}
