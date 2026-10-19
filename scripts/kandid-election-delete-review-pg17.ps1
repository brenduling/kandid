[CmdletBinding()]
param([switch] $Execute)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$repository=Split-Path -Parent $PSScriptRoot
$container='supabase_db_kandid-managed-function-regression-20261'
$expectedId='abf3a8240fbb76964938373bd8c1463a4573e9468815ca783c282d7eec1548f4'
if (-not $Execute) { Write-Output 'REVIEW_ONLY: use -Execute to create only a new isolated scratch database; no cloud operation exists.'; return }
function Invoke-LocalDocker { param([string[]]$Arguments)
  $result=& docker --context desktop-linux @Arguments
  if($LASTEXITCODE -ne 0){throw 'ISOLATED_DOCKER_COMMAND_FAILED'}
  return $result
}
$raw=Invoke-LocalDocker @('inspect',$container)
$info=@((($raw -join "`n") | ConvertFrom-Json))[0]
$mount=@($info.Mounts | Where-Object {$_.Destination -eq '/var/lib/postgresql/data'})
$bindings=@($info.HostConfig.PortBindings.'5432/tcp')
if($info.Id -cne $expectedId -or -not $info.State.Running -or
 $info.Config.Image -cne 'public.ecr.aws/supabase/postgres:17.11.0.004' -or
 $info.Config.Labels.'com.supabase.cli.project' -cne 'kandid-managed-function-regression-20261' -or
 $mount.Count -ne 1 -or $mount[0].Name -cne $container -or
 $bindings.Count -ne 1 -or $bindings[0].HostPort -cne '58322'){throw 'ISOLATION_MISMATCH'}
$suffix=[Guid]::NewGuid().ToString('N').Substring(0,12)
$database='kandid_delete_review_'+$suffix
$stage='/tmp/kandid-delete-review-'+$suffix
Invoke-LocalDocker @('exec',$container,'createdb','-h','/var/run/postgresql','-U','postgres','--template=template0',$database) | Out-Null
Invoke-LocalDocker @('exec',$container,'mkdir','-p',$stage) | Out-Null
$files=@(
 @('fixture.sql','supabase/runtime-validation/election-delete-review-fixture.sql'),
 @('migration.sql','supabase/migrations/20261018120000_board_election_delete_dependency_count.sql'),
 @('tests.sql','supabase/runtime-validation/election-delete-review-tests.sql')
)
foreach($item in $files){
 $source=Join-Path $repository $item[1]
 Invoke-LocalDocker @('cp',$source,($container+':'+$stage+'/'+$item[0])) | Out-Null
 $actual=Invoke-LocalDocker @('exec',$container,'sha256sum',($stage+'/'+$item[0]))
 $expected=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
 if(-not ($actual -join '').StartsWith($expected+' ')){throw 'TEST_FILE_HASH_MISMATCH'}
}
$identity=Invoke-LocalDocker @('exec',$container,'psql','-X','-h','/var/run/postgresql','-U','postgres','-d',$database,'-At','-v','ON_ERROR_STOP=1','-c',"select current_database() || '|' || current_setting('server_version') || '|' || (inet_server_addr() is null)::text;")
if(-not ($identity -join '').StartsWith($database+'|17.') -or -not ($identity -join '').EndsWith('|true')){throw 'SQL_IDENTITY_MISMATCH'}
Write-Output ('ISOLATED_DATABASE='+$database)
Write-Output ('SQL_IDENTITY='+($identity -join ''))
foreach($file in @('fixture.sql','migration.sql','tests.sql')){
 Invoke-LocalDocker @('exec',$container,'psql','-X','-h','/var/run/postgresql','-U','postgres','-d',$database,'-v','ON_ERROR_STOP=1','-f',($stage+'/'+$file))
}
Write-Output '31 PostgreSQL security assertions passed. Scratch database retained; no production connection, database reset, or global role change occurred.'
