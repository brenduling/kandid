[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ApprovedCommit = 'b66f702c0bdca8e03ecc0454af7b1881b1bec09f'
$Repository = 'brenduling/kandid'
$ExpectedFiles = @(
    '.github/workflows/anchor-ballot-hashes.yml',
    '.github/workflow-proposals/anchor-ballot-hashes.yml',
    'docs/anchor-ballot-github-actions-preparation.md',
    'tests/anchorBallotGithubScheduler.test.mjs'
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WorktreePath = Join-Path ([System.IO.Path]::GetTempPath()) ('kandid-scheduler-publish-' + [guid]::NewGuid().ToString('N'))
$WorktreeCreated = $false
$PushAttempted = $false
$Failure = $null

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)][string]$At,
        [Parameter(Mandatory = $true)][string[]]$GitArguments
    )

    # Windows PowerShell 5.1 can turn native stderr into a terminating
    # WriteErrorException when ErrorActionPreference is Stop, even when Git
    # exits successfully (for example, "Preparing worktree" progress).
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& git -C $At @GitArguments 2>$null)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        throw ('git command failed: git ' + ($GitArguments -join ' '))
    }
    return $output
}

function Invoke-Gh {
    param([Parameter(Mandatory = $true)][string[]]$GhArguments)

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& gh @GhArguments 2>$null)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        throw ('GitHub CLI command failed: gh ' + ($GhArguments -join ' '))
    }
    return $output
}

function Assert-ExactPaths {
    param(
        [string[]]$Actual,
        [string[]]$Expected,
        [string]$Description
    )

    $actualSet = @($Actual | Where-Object { $_ } | Sort-Object -Unique)
    $expectedSet = @($Expected | Sort-Object -Unique)
    if (($actualSet -join "`n") -cne ($expectedSet -join "`n")) {
        throw ($Description + ' did not contain exactly the four approved paths.')
    }
}

function Confirm-GitHubGate {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & gh auth status --hostname github.com *> $null
        $authExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($authExitCode -ne 0) {
        throw 'GitHub CLI authentication failed; no publication was attempted.'
    }

    $login = (@(Invoke-Gh -GhArguments @('api', 'user', '--jq', '.login')) -join '').Trim()
    if ($login -cne 'brenduling') {
        throw 'GitHub CLI is authenticated as an unexpected account; no publication was attempted.'
    }

    $enabled = (@(Invoke-Gh -GhArguments @('variable', 'get', 'KANDID_ANCHOR_SCHEDULER_ENABLED', '--repo', $Repository)) -join "`n").Trim()
    if ($enabled -cne 'false') {
        throw 'KANDID_ANCHOR_SCHEDULER_ENABLED is not exactly false; no publication was attempted.'
    }
}

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git is unavailable in this PowerShell session.'
    }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'GitHub CLI is unavailable in this PowerShell session.'
    }

    $top = (@(Invoke-Git -At $RepoRoot -GitArguments @('rev-parse', '--show-toplevel')) -join '').Trim()
    if ([System.IO.Path]::GetFullPath($top) -ne [System.IO.Path]::GetFullPath($RepoRoot)) {
        throw 'Script is not running from the expected Kandid repository.'
    }

    $fetchUrl = (@(Invoke-Git -At $RepoRoot -GitArguments @('remote', 'get-url', 'origin')) -join '').Trim()
    $pushUrl = (@(Invoke-Git -At $RepoRoot -GitArguments @('remote', 'get-url', '--push', 'origin')) -join '').Trim()
    $allowedRemote = '^(https://github\.com/brenduling/kandid(?:\.git)?|git@github\.com:brenduling/kandid(?:\.git)?|ssh://git@github\.com/brenduling/kandid(?:\.git)?)$'
    if ($fetchUrl -notmatch $allowedRemote -or $pushUrl -notmatch $allowedRemote) {
        throw 'origin fetch/push URLs do not both target brenduling/kandid; no publication was attempted.'
    }

    Confirm-GitHubGate

    try {
        Invoke-Git -At $RepoRoot -GitArguments @('cat-file', '-e', ($ApprovedCommit + '^{commit}')) | Out-Null
    } catch {
        throw 'The approved commit is not available locally.'
    }

    $commitParents = (@(Invoke-Git -At $RepoRoot -GitArguments @('rev-list', '--parents', '-n', '1', $ApprovedCommit)) -join ' ').Trim() -split '\s+'
    if ($commitParents.Count -ne 2) {
        throw 'The approved commit is not a single-parent commit.'
    }
    $approvedCommitFiles = @(Invoke-Git -At $RepoRoot -GitArguments @('diff-tree', '--no-commit-id', '--name-only', '-r', $ApprovedCommit))
    Assert-ExactPaths -Actual $approvedCommitFiles -Expected $ExpectedFiles -Description 'Approved commit file list'

    Invoke-Git -At $RepoRoot -GitArguments @('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main') | Out-Null
    $BaseSha = (@(Invoke-Git -At $RepoRoot -GitArguments @('rev-parse', 'refs/remotes/origin/main')) -join '').Trim()

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & git -C $RepoRoot merge-base --is-ancestor $ApprovedCommit refs/remotes/origin/main 2>$null
        $ancestorExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($ancestorExit -eq 0) {
        throw 'The approved commit is already an ancestor of origin/main; refusing an empty cherry-pick.'
    }
    if ($ancestorExit -ne 1) {
        throw 'Could not determine whether the approved commit is already on origin/main.'
    }

    Invoke-Git -At $RepoRoot -GitArguments @('worktree', 'add', '--detach', $WorktreePath, 'refs/remotes/origin/main') | Out-Null
    $WorktreeCreated = $true

    $initialStatus = @(Invoke-Git -At $WorktreePath -GitArguments @('status', '--porcelain', '--untracked-files=all'))
    if ($initialStatus.Count -ne 0) {
        throw 'Temporary worktree was not clean immediately after creation.'
    }
    $worktreeBaseSha = (@(Invoke-Git -At $WorktreePath -GitArguments @('rev-parse', 'HEAD')) -join '').Trim()
    if ($worktreeBaseSha -cne $BaseSha) {
        throw 'Temporary worktree is not based on the fetched origin/main commit.'
    }

    Invoke-Git -At $WorktreePath -GitArguments @('cherry-pick', $ApprovedCommit) | Out-Null

    $headFiles = @(Invoke-Git -At $WorktreePath -GitArguments @('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'))
    Assert-ExactPaths -Actual $headFiles -Expected $ExpectedFiles -Description 'Cherry-picked commit file list'
    $publishedDiffFiles = @(Invoke-Git -At $WorktreePath -GitArguments @('diff', '--name-only', 'refs/remotes/origin/main', 'HEAD'))
    Assert-ExactPaths -Actual $publishedDiffFiles -Expected $ExpectedFiles -Description 'Resulting origin/main diff'

    $headParent = (@(Invoke-Git -At $WorktreePath -GitArguments @('rev-parse', 'HEAD^')) -join '').Trim()
    if ($headParent -cne $BaseSha) {
        throw 'Isolated commit parent does not equal the fetched origin/main tip.'
    }
    $postCherryPickStatus = @(Invoke-Git -At $WorktreePath -GitArguments @('status', '--porcelain', '--untracked-files=all'))
    if ($postCherryPickStatus.Count -ne 0) {
        throw 'The isolated publication worktree contains changes outside its reviewed commit.'
    }

    $workflowPath = Join-Path $WorktreePath '.github/workflows/anchor-ballot-hashes.yml'
    $testPath = Join-Path $WorktreePath 'tests/anchorBallotGithubScheduler.test.mjs'
    if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $testPath -PathType Leaf)) {
        throw 'The isolated publication commit is missing the workflow or its targeted regression test.'
    }
    $workflow = [System.IO.File]::ReadAllText($workflowPath)
    if ($workflow -notmatch "vars\.KANDID_ANCHOR_SCHEDULER_ENABLED\s*==\s*'true'" -or
        $workflow -notmatch "github\.repository\s*==\s*'brenduling/kandid'" -or
        $workflow -notmatch "github\.ref\s*==\s*'refs/heads/main'" -or
        $workflow -notmatch "github\.event_name\s*==\s*'schedule'" -or
        $workflow -notmatch "github\.event_name\s*==\s*'workflow_dispatch'" -or
        $workflow -notmatch 'inputs\.confirm_anchor_pending_ballots\s*==\s*true' -or
        $workflow -notmatch 'confirm_anchor_pending_ballots:[\s\S]*?default:\s*false') {
        throw 'Workflow publication/activation safeguards do not match the reviewed contract.'
    }

    $actionlint = Join-Path $RepoRoot '.tmp/anchor-scheduler-tools/actionlint/actionlint.exe'
    if (-not (Test-Path -LiteralPath $actionlint)) {
        $actionlintCommand = Get-Command actionlint -ErrorAction SilentlyContinue
        if ($actionlintCommand) {
            $actionlint = $actionlintCommand.Source
        } else {
            throw 'actionlint is unavailable; validation stopped before publication.'
        }
    }
    & $actionlint $workflowPath
    if ($LASTEXITCODE -ne 0) {
        throw 'actionlint failed; publication stopped.'
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is unavailable; targeted validation stopped before publication.'
    }
    Push-Location $WorktreePath
    try {
        & node --test tests/anchorBallotGithubScheduler.test.mjs
        if ($LASTEXITCODE -ne 0) {
            throw 'Targeted scheduler regression tests failed; publication stopped.'
        }
    } finally {
        Pop-Location
    }
    $postTestStatus = @(Invoke-Git -At $WorktreePath -GitArguments @('status', '--porcelain', '--untracked-files=all'))
    if ($postTestStatus.Count -ne 0) {
        throw 'Validation changed the isolated publication worktree; publication stopped.'
    }

    Invoke-Git -At $WorktreePath -GitArguments @('diff', '--check', 'refs/remotes/origin/main', 'HEAD') | Out-Null

    $pushSha = (@(Invoke-Git -At $WorktreePath -GitArguments @('rev-parse', 'HEAD')) -join '').Trim()
    Confirm-GitHubGate

    $remoteTipBeforePush = (@(Invoke-Git -At $RepoRoot -GitArguments @('ls-remote', 'origin', 'refs/heads/main')) -join '').Trim()
    if (-not $remoteTipBeforePush) {
        throw 'Could not read the current origin/main tip; publication stopped.'
    }
    $remoteTipBeforePush = ($remoteTipBeforePush -split '\s+')[0]
    if ($remoteTipBeforePush -cne $BaseSha) {
        throw 'origin/main changed after fetch; rerun from a fresh origin/main.'
    }

    Confirm-GitHubGate
    $PushAttempted = $true
    Invoke-Git -At $WorktreePath -GitArguments @('push', 'origin', 'HEAD:refs/heads/main') | Out-Null

    $remoteTipAfterPush = (@(Invoke-Git -At $RepoRoot -GitArguments @('ls-remote', 'origin', 'refs/heads/main')) -join '').Trim()
    if (-not $remoteTipAfterPush -or (($remoteTipAfterPush -split '\s+')[0] -cne $pushSha)) {
        throw 'Post-push origin/main verification did not match the isolated commit.'
    }

    $githubMainSha = (@(Invoke-Gh -GhArguments @('api', 'repos/' + $Repository + '/commits/main', '--jq', '.sha')) -join '').Trim()
    if ($githubMainSha -cne $pushSha) {
        throw 'GitHub API did not report the pushed commit on main.'
    }
    $localBlobSha = (@(Invoke-Git -At $WorktreePath -GitArguments @('hash-object', $workflowPath)) -join '').Trim()
    $remoteBlobSha = (@(Invoke-Gh -GhArguments @('api', 'repos/' + $Repository + '/contents/.github/workflows/anchor-ballot-hashes.yml?ref=main', '--jq', '.sha')) -join '').Trim()
    if ($remoteBlobSha -cne $localBlobSha) {
        throw 'Published workflow blob does not match the validated local workflow.'
    }

    Confirm-GitHubGate

    $recentRunsJson = (@(Invoke-Gh -GhArguments @('run', 'list', '--repo', $Repository, '--workflow', 'anchor-ballot-hashes.yml', '--branch', 'main', '--limit', '20', '--json', 'databaseId,headSha,event')) -join "`n")
    $recentRuns = @($recentRunsJson | ConvertFrom-Json)
    $publishedRuns = @($recentRuns | Where-Object { $_.headSha -ceq $pushSha })
    foreach ($run in $publishedRuns) {
        $anchorConclusion = (@(Invoke-Gh -GhArguments @('run', 'view', [string]$run.databaseId, '--repo', $Repository, '--json', 'jobs', '--jq', '.jobs[] | select(.name == "anchor") | .conclusion')) -join '').Trim()
        if ($anchorConclusion -cne 'skipped') {
            throw 'A run for the published commit did not show the anchor job as skipped; inspect GitHub Actions immediately.'
        }
    }

    Write-Host ('Published commit: ' + $pushSha)
    Write-Host 'Verified: GitHub main and workflow blob match the isolated reviewed change.'
    Write-Host 'Verified: scheduler variable is exactly false; any observed anchor job was skipped.'
    Write-Host 'No worker invocation was issued by this script.'
} catch {
    $Failure = $_.Exception.Message
} finally {
    # This run owns only its freshly generated temp path. Verify it is the
    # registered, clean worktree before removing it; never force-remove it.
    if ($WorktreeCreated -or (Test-Path -LiteralPath $WorktreePath)) {
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
        $normalizedPath = [System.IO.Path]::GetFullPath($WorktreePath)
        $isExpectedTempPath = $normalizedPath.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and
            ([System.IO.Path]::GetFileName($normalizedPath) -match '^kandid-scheduler-publish-[0-9a-f]{32}$')
        $registered = $false
        $clean = $false
        if ($isExpectedTempPath) {
            try {
                $worktreeList = @(Invoke-Git -At $RepoRoot -GitArguments @('worktree', 'list', '--porcelain'))
                $gitPath = $normalizedPath.Replace('\', '/')
                $registered = @($worktreeList | Where-Object { $_ -ceq ('worktree ' + $gitPath) }).Count -gt 0
                if ($registered) {
                    $cleanupStatus = @(Invoke-Git -At $WorktreePath -GitArguments @('status', '--porcelain', '--untracked-files=all'))
                    $clean = $cleanupStatus.Count -eq 0
                }
            } catch {
                $registered = $false
                $clean = $false
            }
        }
        if ($registered -and $clean) {
            try {
                Invoke-Git -At $RepoRoot -GitArguments @('worktree', 'remove', $WorktreePath) | Out-Null
            } catch {
                Write-Warning ('Temporary worktree cleanup failed; inspect this path manually: ' + $WorktreePath)
            }
        } elseif (Test-Path -LiteralPath $WorktreePath) {
            Write-Warning ('Temporary path was not removed because it was unregistered, dirty, or could not be verified; inspect manually: ' + $WorktreePath)
        }
    }
}

if ($Failure) {
    if ($PushAttempted) {
        Write-Error ($Failure + ' A push was attempted; inspect GitHub main before rerunning.')
    } else {
        Write-Error $Failure
    }
    exit 1
}
