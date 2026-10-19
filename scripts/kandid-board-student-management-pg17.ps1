[CmdletBinding()]
param([switch] $Execute)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$repository = Split-Path -Parent $PSScriptRoot
$expectedContainer = 'supabase_db_kandid-managed-function-regression-20261'
$expectedProject = 'kandid-managed-function-regression-20261'
$expectedContainerId = 'abf3a8240fbb76964938373bd8c1463a4573e9468815ca783c282d7eec1548f4'
$expectedHash = 'B2980B1D10092B460720ED3A3C5623367D9F2B3381C99B15572241BF8C959958'
$schemaSource = Join-Path $repository 'supabase\migrations\20261021120000_board_verified_student_registration.sql'
if ((Get-FileHash -LiteralPath $schemaSource -Algorithm SHA256).Hash -cne $expectedHash) {
    throw 'REVIEWED_REGISTRATION_SCHEMA_HASH_MISMATCH'
}
if (-not $Execute) {
    Write-Output 'REVIEW_ONLY: no Docker calls or SQL executed.'
    Write-Output ('CONTAINER=' + $expectedContainer)
    Write-Output 'Creates only a new kandid_sm_v7_<random> database inside that exact disposable PG17 container.'
    Write-Output 'Loads reviewed schema as synthetic test fixtures only; no cloud connection or migration-ledger operation exists.'
    Write-Output 'Tests real Add, existing enrollment, Edit persistence, Remove, Restore, duplicate prevention, grants, rollback, and history.'
    return
}

function Invoke-TestDocker {
    param([string[]] $DockerArguments)
    $result = & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw 'DISPOSABLE_DOCKER_COMMAND_FAILED' }
    return $result
}

$inspectionText = Invoke-TestDocker @('inspect', $expectedContainer)
$inspection = @((($inspectionText -join "`n") | ConvertFrom-Json))[0]
$volume = @($inspection.Mounts | Where-Object { $_.Destination -eq '/var/lib/postgresql/data' })
$bindings = @($inspection.HostConfig.PortBindings.'5432/tcp')
if ($inspection.Id -cne $expectedContainerId -or -not $inspection.State.Running -or
    $inspection.Config.Image -cne 'public.ecr.aws/supabase/postgres:17.11.0.004' -or
    $inspection.Config.Labels.'com.supabase.cli.project' -cne $expectedProject -or
    $volume.Count -ne 1 -or $volume[0].Name -cne $expectedContainer -or
    $bindings.Count -ne 1 -or $bindings[0].HostPort -cne '58322') {
    throw 'DISPOSABLE_CONTAINER_ISOLATION_MISMATCH'
}
$roleCount = Invoke-TestDocker @('exec', $expectedContainer, 'psql', '-X', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "select count(*) from pg_roles where rolname in ('anon','authenticated','service_role');")
if (($roleCount -join '').Trim() -cne '3') { throw 'EXPECTED_EXISTING_TEST_ROLES_MISSING' }

$suffix = [Guid]::NewGuid().ToString('N').Substring(0,12)
$database = 'kandid_sm_v7_' + $suffix
$containerDirectory = '/tmp/kandid-sm-v7-' + $suffix
$localDirectory = Join-Path ([IO.Path]::GetTempPath()) ('kandid-sm-v7-' + $suffix)
[IO.Directory]::CreateDirectory($localDirectory) | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
$fixture = [IO.File]::ReadAllText((Join-Path $repository 'supabase\runtime-validation\board-verified-registration-pg17-fixture.sql'))
# Reuse existing roles without changing their global definitions or grants.
$fixture = [regex]::Replace($fixture, '(?m)^CREATE ROLE (anon|authenticated|service_role)[^\r\n]*(\r?\n|$)', '')
[IO.File]::WriteAllText((Join-Path $localDirectory 'fixture.sql'), $fixture, $utf8)
$sourceFiles = @{
    'guard.sql' = 'supabase\runtime-validation\board-verified-registration-pg17-guard-baseline.sql'
    'registration-schema.sql' = 'supabase\migrations\20261021120000_board_verified_student_registration.sql'
    'participation-schema.sql' = 'supabase\migrations\20261003140000_guard_board_participation_scope.sql'
    'management-fixture.sql' = 'supabase\runtime-validation\board-student-management-v7-fixture.sql'
    'tests.sql' = 'supabase\runtime-validation\board-student-management-v7-tests.sql'
}
foreach ($item in $sourceFiles.GetEnumerator()) {
    [IO.File]::WriteAllBytes((Join-Path $localDirectory $item.Key), [IO.File]::ReadAllBytes((Join-Path $repository $item.Value)))
}
$driver = @(
    '\set ON_ERROR_STOP on',
    ('DO $isolation$ BEGIN IF current_database() <> ''' + $database + ''' OR inet_server_addr() IS NOT NULL OR current_setting(''server_version_num'')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION ''LOCAL_TEST_IDENTITY_FAILED''; END IF; END $isolation$;'),
    ('\i ' + $containerDirectory + '/fixture.sql'),
    ('\i ' + $containerDirectory + '/guard.sql'),
    ('\i ' + $containerDirectory + '/registration-schema.sql'),
    ('\i ' + $containerDirectory + '/participation-schema.sql'),
    ('\i ' + $containerDirectory + '/management-fixture.sql'),
    ('\i ' + $containerDirectory + '/tests.sql')
) -join "`n"
[IO.File]::WriteAllText((Join-Path $localDirectory 'driver.sql'), $driver, $utf8)

Invoke-TestDocker @('exec', $expectedContainer, 'createdb', '-h', '/var/run/postgresql', '-U', 'postgres', '--template=template0', $database) | Out-Null
Invoke-TestDocker @('exec', $expectedContainer, 'mkdir', '-p', $containerDirectory) | Out-Null
foreach ($file in Get-ChildItem -LiteralPath $localDirectory -File) {
    Invoke-TestDocker @('cp', $file.FullName, ($expectedContainer + ':' + $containerDirectory + '/' + $file.Name)) | Out-Null
}
Write-Output ('ISOLATED_DATABASE=' + $database)
Write-Output ('SQL_DRIVER=' + $containerDirectory + '/driver.sql')
Invoke-TestDocker @('exec', $expectedContainer, 'psql', '-X', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', $database, '-v', 'ON_ERROR_STOP=1', '-f', ($containerDirectory + '/driver.sql'))
Write-Output 'Test fixture DB retained for review; application test writes were rolled back. No database or volume was removed.'
