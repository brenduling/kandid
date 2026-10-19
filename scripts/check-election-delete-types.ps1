$ErrorActionPreference='Stop'
$repository=Split-Path -Parent $PSScriptRoot
Push-Location $repository
try {
  $evidence=Join-Path $repository 'deploy\election-delete-review\evidence'
  & npm.cmd exec --yes --package=typescript@5.9.3 -- tsc -p deploy/election-delete-review/tsconfig.json *> (Join-Path $evidence 'typecheck-full.log')
  $fullExit=$LASTEXITCODE
  $lines=@(Get-Content (Join-Path $evidence 'typecheck-full.log') | Where-Object {$_ -match ': error TS[0-9]+:'})
  $candidate=@($lines | Where-Object {$_ -like 'deploy/election-delete-review/candidate/*'} | ForEach-Object {$_ -replace '^deploy/election-delete-review/candidate/supabase/functions/vote-access/index.ts','index.ts'})
  $baseline=@($lines | Where-Object {$_ -like 'deploy/election-delete-review/rollback/vote-access-v6/*'} | ForEach-Object {$_ -replace '^deploy/election-delete-review/rollback/vote-access-v6/functions/vote-access/index.ts','index.ts'})
  if($fullExit -notin @(0,1,2) -or ($fullExit -ne 0 -and $lines.Count -eq 0) -or
    ($fullExit -eq 0 -and $lines.Count -ne 0) -or $lines.Count -ne ($candidate.Count+$baseline.Count) -or
    ($candidate -join "`n") -cne ($baseline -join "`n")){throw 'NEW_OR_UNCLASSIFIED_TYPESCRIPT_DIAGNOSTIC'}
  & npm.cmd exec --yes --package=typescript@5.9.3 -- tsc -p deploy/election-delete-review/tsconfig-new-contract.json *> (Join-Path $evidence 'typecheck-new-contract.log')
  if($LASTEXITCODE -ne 0){throw 'NEW_CONTRACT_TYPECHECK_FAILED'}
  $result=[ordered]@{compiler='TypeScript 5.9.3';new_contract='PASS';inherited_errors_per_file=$baseline.Count;new_errors=0;full_program_exit=$fullExit}
  $json=$result | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $evidence 'typecheck-results.json'),$json,(New-Object Text.UTF8Encoding($false)))
  Write-Output $json
} finally {Pop-Location}
