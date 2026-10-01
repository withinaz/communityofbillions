#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Runs one maintenance pass for communityofbillions.

.DESCRIPTION
    Pulls the repository, hands the maintenance brief to a headless agent, then makes sure
    whatever the agent produced is either committed and pushed, or clearly reported as
    uncommitted and left for a human.

    The runner is deliberately paranoid about one thing: nothing may sit in the working tree
    uncommitted and unnoticed. Everything else it is happy to leave to the agent.

.PARAMETER DryRun
    Compose the prompt and print it, but do not invoke the agent.

.PARAMETER NoPush
    Do not push anything. Useful for a rehearsal.

.PARAMETER CheckGates
    Run the quality gates against the working tree and exit. No agent is invoked, so this
    costs nothing but a test run. Useful to answer "is the repository healthy right now?"
    without starting a maintenance pass.

.PARAMETER CommentsOnly
    Run only the comment responder, then exit. The maintenance agent is not invoked and no
    code is touched. Use it to catch up on comments without spending a maintenance pass.

.EXAMPLE
    pwsh tools/schedule/run-pass.ps1
    pwsh tools/schedule/run-pass.ps1 -DryRun
    pwsh tools/schedule/run-pass.ps1 -CheckGates
    pwsh tools/schedule/run-pass.ps1 -CommentsOnly -DryRun
#>
[CmdletBinding()]
param(
    [switch] $DryRun,
    [switch] $NoPush,
    [switch] $CheckGates,
    [switch] $CommentsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Native commands write UTF-8. When their output is captured rather than shown on a console,
# PowerShell decodes it with the OEM code page, which turns every em dash in the agent's
# reasoning into "ΓÇö" in the log. The logs are meant to be read, so fix the decoding.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------- paths

$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path

$LogDir = if ($env:COB_LOG_DIR) {
    $env:COB_LOG_DIR
} else {
    Join-Path (Split-Path -Parent $RepoPath) 'communityofbillions-maintenance\logs'
}

$IndexFile = Join-Path $LogDir 'maintenance.log'
$ResultFile = Join-Path $LogDir 'result.txt'
$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$PassLog = Join-Path $LogDir "pass-$Stamp.log"

# Operational state for the comment responder: beside the logs, outside the repository.
$StateDir = if ($env:COB_STATE_DIR) {
    $env:COB_STATE_DIR
} else {
    Join-Path (Split-Path -Parent $LogDir) 'state'
}

$CommentStateFile = Join-Path $StateDir 'answered-comments.json'
$PendingFile = Join-Path $StateDir 'pending-comments.json'
$RepliesFile = Join-Path $StateDir 'replies.json'

$CommentBriefPath = Join-Path $RepoPath 'agents/comment-responder/brief.md'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log {
    param([string] $Message, [string] $Level = 'INFO')
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Level, $Message
    Write-Host $line
    Add-Content -Path $PassLog -Value $line -Encoding utf8
}

function Write-Index {
    param([string] $Message)
    Add-Content -Path $IndexFile -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message) -Encoding utf8
}

function Write-Result {
    <#
        Append one line to result.txt: the verdict of a pass, and nothing else.

        The detailed logs exist and are verbose on purpose. This file answers one question —
        "did the pass work?" — in a single line, newest first, so it can be read in a glance
        without scrolling or parsing timestamps.

            passe du mercredi 30/09/2026 09:04 -- ok
            passe du lundi 05/10/2026 09:03 -- echec (les portes echouent)
    #>
    param([Parameter(Mandatory)][string] $Verdict)

    # Day names are mapped explicitly rather than taken from the current culture: a scheduled
    # task has no reliable UI culture, and an English day name in a French file is the kind of
    # detail that makes a log feel untrustworthy.
    $dayNames = @{
        'Monday'    = 'lundi'
        'Tuesday'   = 'mardi'
        'Wednesday' = 'mercredi'
        'Thursday'  = 'jeudi'
        'Friday'    = 'vendredi'
        'Saturday'  = 'samedi'
        'Sunday'    = 'dimanche'
    }

    $now = Get-Date
    $label = '{0} {1} {2}' -f $dayNames[$now.DayOfWeek.ToString()], $now.ToString('dd/MM/yyyy'), $now.ToString('HH:mm')
    $line = "passe du $label -- $Verdict"

    $previous = @()
    if (Test-Path -LiteralPath $ResultFile) {
        $previous = @(Get-Content -LiteralPath $ResultFile -ErrorAction SilentlyContinue | Where-Object { $_ -ne '' })
    }

    Set-Content -LiteralPath $ResultFile -Value (@($line) + $previous) -Encoding utf8
    Write-Log "result     : $line"
}

function Get-PowerShellHost {
    <#
        A pwsh.exe this process can actually launch, or $null.

        `Get-Command pwsh` is not good enough. A Microsoft Store install of PowerShell 7 puts a
        0-byte app execution alias on PATH; it works from an interactive shell and fails with
        ERROR_FILE_NOT_FOUND from an unattended one. $PSHOME is the real installation directory
        of the interpreter currently running, which is exactly the thing we want to launch.
    #>
    if ($PSVersionTable.PSEdition -eq 'Core') {
        $candidate = Join-Path $PSHOME 'pwsh.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    $found = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($found) {
        $item = Get-Item -LiteralPath $found.Source -ErrorAction SilentlyContinue
        # A file of length zero is the app execution alias, not a program.
        if ($item -and $item.Length -gt 0) { return $found.Source }
    }

    return $null
}

function Test-Gates {
    <#
        The quality gates from agents/maintenance/CHECKS.md, applied to whatever is currently
        in the working tree.

        The runner uses this before committing work an agent left behind. It must not publish
        something the agent itself would have been forbidden to push: a runner that does that
        turns "the gates failed" into a red main branch nobody notices.
    #>
    param([Parameter(Mandatory)][string] $RepoRoot)

    $ok = $true

    $jsFiles = Get-ChildItem -Path (Join-Path $RepoRoot 'packages') -Recurse -Filter '*.js' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' }
    foreach ($file in $jsFiles) {
        & node --check $file.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Log "  syntax FAIL: $($file.FullName)" 'WARN'
            & node --check $file.FullName 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Log "    $_" 'WARN' }
            $ok = $false
        }
    }

    $testOutput = & node --test "packages/core/**/*.test.js" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log '  the test suite failed:' 'WARN'
        $testOutput | Select-Object -Last 40 | ForEach-Object { Write-Log "    $_" 'WARN' }
        $ok = $false
    }

    $exampleOutput = & node examples/two-agents/run.js 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log '  the two-agents example failed:' 'WARN'
        $exampleOutput | Select-Object -Last 30 | ForEach-Object { Write-Log "    $_" 'WARN' }
        $ok = $false
    }

    # The runner is code too. Its decision logic — what is worth answering, what may be posted,
    # what has already been handled — has tests, and they run with the rest of the gates.
    $runnerTests = Join-Path $RepoRoot 'tools/schedule/tests/run-pass.tests.ps1'
    if (Test-Path -LiteralPath $runnerTests) {
        $testHost = Get-PowerShellHost
        if ($testHost) {
            $runnerOutput = & $testHost -NoProfile -File $runnerTests 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Log '  the runner tests failed:' 'WARN'
                $runnerOutput | Select-Object -Last 25 | ForEach-Object { Write-Log "    $_" 'WARN' }
                $ok = $false
            }
        } else {
            Write-Log '  no launchable PowerShell 7 host, so the runner tests were skipped' 'WARN'
        }
    }

    if ($ok) { Write-Log 'all gates pass' }
    return $ok
}

function Resolve-DshCommand {
    <#
        Locate the dsh launcher.

        This deliberately does NOT just call `Get-Command dsh`.

        A `dsh` started through `npx` puts its own shim directory on PATH **for its children
        only**. A task started by Windows Task Scheduler inherits the logon session's PATH,
        which does not contain the npx cache. An earlier version of this script relied on
        `Get-Command` alone and would have failed with "dsh not found" on the very first
        unattended run — after reporting that everything was ready.

        Search order, most explicit first:
          1. $env:COB_DSH                       — operator override
          2. PATH
          3. npm global prefix, %APPDATA%\npm   — a real install
          4. <log dir>\dsh-path.txt             — what the last successful run used
          5. the npx cache, newest first        — works, but volatile: npm may prune it
    #>
    if ($env:COB_DSH) {
        if (-not (Test-Path -LiteralPath $env:COB_DSH)) {
            throw "COB_DSH is set to '$env:COB_DSH', which does not exist."
        }
        return $env:COB_DSH
    }

    $onPath = Get-Command dsh -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    $prefix = $null
    try { $prefix = (npm config get prefix 2>$null | Select-Object -First 1) } catch { }

    $candidates = @()
    if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'npm\dsh.cmd') }
    if ($prefix) { $candidates += (Join-Path $prefix 'dsh.cmd') }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    # The pin is deliberately checked *after* a real install. It records whatever worked last
    # time, which may well be the npx cache — a stable install must always beat a memory of a
    # temporary one.
    $pinnedFile = Join-Path $LogDir 'dsh-path.txt'
    if (Test-Path -LiteralPath $pinnedFile) {
        $pinned = Get-Content -LiteralPath $pinnedFile -Raw -ErrorAction SilentlyContinue
        if ($pinned) {
            $pinned = $pinned.Trim()
            if ($pinned -and (Test-Path -LiteralPath $pinned)) { return $pinned }
        }
    }

    if ($env:LOCALAPPDATA) {
        $pattern = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\*\node_modules\.bin\dsh.ps1'
        $found = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
        if ($found) { return $found[0].FullName }
    }

    return $null
}

# ---------------------------------------------------------------- comment responder

function Get-Field {
    <#
        Read a property that may not exist.

        Set-StrictMode Latest makes a missing property a terminating error, and the GitHub API
        is not consistent about which optional fields it includes. This is the only safe way to
        read one.
    #>
    param(
        [Parameter(Mandatory)][AllowNull()] $Object,
        [Parameter(Mandatory)][string] $Name,
        [AllowNull()] $Default = $null
    )

    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Get-RepositorySlug {
    param([Parameter(Mandatory)][string] $RepoRoot)

    $url = & git -C $RepoRoot remote get-url origin 2>$null
    if (-not $url) { return $null }
    # https://github.com/owner/name.git  or  git@github.com:owner/name.git
    if ($url -match '[:/]([^/:]+)/([^/]+?)(\.git)?$') { return "$($Matches[1])/$($Matches[2])" }
    return $null
}

function Get-RepositoryComments {
    <#
        Every issue comment and pull-request review comment on the repository.

        Timestamps are reduced to Unix epoch seconds. GitHub returns ISO 8601 and PowerShell's
        ConvertFrom-Json turns that into a DateTime; comparing DateTimes that have been
        round-tripped through JSON is a needless source of ambiguity, and an integer cannot be
        misread. `issue` covers both issue threads and the conversation on a pull request.
    #>
    param([Parameter(Mandatory)][string] $Repo)

    $comments = @()

    $issuePages = & gh api --paginate --slurp "repos/$Repo/issues/comments?per_page=100" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "gh api could not list issue comments: $issuePages" }

    foreach ($page in ($issuePages | ConvertFrom-Json)) {
        foreach ($c in $page) {
            $app = Get-Field -Object $c -Name 'performed_via_github_app'
            $comments += [pscustomobject]@{
                key            = "issue:$($c.id)"
                kind           = 'issue'
                id             = [int64]$c.id
                author         = [string]$c.user.login
                authorType     = [string]$c.user.type
                appSlug        = $(if ($null -ne $app) { [string](Get-Field -Object $app -Name 'slug') } else { $null })
                body           = [string]$c.body
                createdAtEpoch = ([DateTimeOffset]$c.created_at).ToUnixTimeSeconds()
                updatedAtEpoch = ([DateTimeOffset]$c.updated_at).ToUnixTimeSeconds()
                url            = [string]$c.html_url
                issueNumber    = [int](($c.issue_url -split '/')[-1])
                pullNumber     = $null
                title          = $null
            }
        }
    }

    $reviewPages = & gh api --paginate --slurp "repos/$Repo/pulls/comments?per_page=100" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "gh api could not list review comments: $reviewPages" }

    foreach ($page in ($reviewPages | ConvertFrom-Json)) {
        foreach ($c in $page) {
            $app = Get-Field -Object $c -Name 'performed_via_github_app'
            $comments += [pscustomobject]@{
                key            = "review:$($c.id)"
                kind           = 'review'
                id             = [int64]$c.id
                author         = [string]$c.user.login
                authorType     = [string]$c.user.type
                appSlug        = $(if ($null -ne $app) { [string](Get-Field -Object $app -Name 'slug') } else { $null })
                body           = [string]$c.body
                createdAtEpoch = ([DateTimeOffset]$c.created_at).ToUnixTimeSeconds()
                updatedAtEpoch = ([DateTimeOffset]$c.updated_at).ToUnixTimeSeconds()
                url            = [string]$c.html_url
                issueNumber    = $null
                pullNumber     = [int](($c.pull_request_url -split '/')[-1])
                title          = $null
            }
        }
    }

    return $comments
}

function Add-CommentTitles {
    <#
        Attach the issue or pull-request title to each comment. A title costs one API call per
        distinct issue and helps the agent answer far better than a bare comment body, so it is
        worth it — but the number of lookups is capped, because a first-time contributor should
        not be able to make a scheduled pass spend an unbounded number of calls.
    #>
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Comments,
        [Parameter(Mandatory)][string] $Repo,
        [int] $MaxLookups = 25
    )

    $cache = @{}
    $lookups = 0

    foreach ($c in $Comments) {
        $number = if ($c.kind -eq 'review') { $c.pullNumber } else { $c.issueNumber }
        if ($null -eq $number) { continue }

        if (-not $cache.ContainsKey($number)) {
            if ($lookups -ge $MaxLookups) { continue }
            $lookups++
            $title = $null
            $out = & gh api "repos/$Repo/issues/$number" --jq '.title' 2>$null
            if ($LASTEXITCODE -eq 0) { $title = ([string]$out).Trim() }
            $cache[$number] = $title
        }
        $c.title = $cache[$number]
    }

    return $Comments
}

function Read-CommentState {
    <#
        Load the record of what has already been answered.

        Throws rather than recovering when the file exists but cannot be parsed. A state file we
        cannot read means we cannot tell what has already been answered, and answering somebody
        twice in public is worse than not answering at all. The caller fails closed on this.
    #>
    param([Parameter(Mandatory)][string] $Path)

    $state = @{ version = 1; updated = $null; comments = @{} }
    if (-not (Test-Path -LiteralPath $Path)) { return $state }

    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return $state }

    $parsed = $raw | ConvertFrom-Json

    $version = Get-Field -Object $parsed -Name 'version'
    if ($null -ne $version) { $state.version = [int]$version }

    $updated = Get-Field -Object $parsed -Name 'updated'
    if ($null -ne $updated) { $state.updated = [string]$updated }

    $comments = Get-Field -Object $parsed -Name 'comments'
    if ($null -ne $comments) {
        $table = @{}
        foreach ($property in $comments.PSObject.Properties) { $table[$property.Name] = $property.Value }
        $state.comments = $table
    }

    return $state
}

function Save-CommentState {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $State
    )

    $State.updated = (Get-Date).ToString('o')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    ($State | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $Path -Encoding utf8
}

function Select-PendingComments {
    <#
        Decide which comments deserve the agent's attention.

        A comment is pending when it is not ours, not a bot's, and either has never been seen or
        has been edited since (`updatedAtEpoch` moved forward). The epoch comparison is what
        makes an edited comment get a fresh look without re-answering every untouched one.
    #>
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Comments,
        [Parameter(Mandatory)] $State,
        [Parameter(Mandatory)][string] $SelfLogin,
        [int] $Max = 20
    )

    $pending = @()
    $skippedOwn = 0
    $skippedSeen = 0
    $capped = 0

    foreach ($c in $Comments) {
        if ($c.author -eq $SelfLogin) { $skippedOwn++; continue }
        if ($c.authorType -eq 'Bot') { $skippedOwn++; continue }
        if ($null -ne $c.appSlug -and $c.appSlug -ne '') { $skippedOwn++; continue }

        $known = $null
        if ($State.comments.ContainsKey($c.key)) { $known = $State.comments[$c.key] }

        if ($null -ne $known) {
            $seenEpoch = Get-Field -Object $known -Name 'updatedAtEpoch'
            if ($null -ne $seenEpoch -and [int64]$seenEpoch -ge [int64]$c.updatedAtEpoch) {
                $skippedSeen++
                continue
            }
            # Falling through here means the comment was edited since we last handled it.
        }

        $pending += $c
    }

    # Oldest first, so a burst of comments is answered in the order it arrived.
    $pending = @($pending | Sort-Object updatedAtEpoch)
    if ($pending.Count -gt $Max) {
        $capped = $pending.Count - $Max
        $pending = @($pending | Select-Object -First $Max)
    }

    return @{ pending = $pending; skippedOwn = $skippedOwn; skippedSeen = $skippedSeen; capped = $capped }
}

function Test-ReplyKey {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string] $Key,
        [Parameter(Mandatory)] $Allowed
    )

    if ([string]::IsNullOrWhiteSpace($Key)) { return @{ ok = $false; reason = 'the reply has no key' } }
    if (-not $Allowed.ContainsKey($Key)) {
        return @{ ok = $false; reason = "the key '$Key' was not in the input, so it was not answered" }
    }
    return @{ ok = $true; reason = $null }
}

function Test-ReplyBody {
    <#
        The last line of defence before something becomes public.

        A reply is rejected if it is empty, if it is long enough to be a wall of text nobody
        asked for, or if it looks like it contains key material. The secret check is cheap
        insurance: the brief forbids it, and this makes the brief not the only thing standing
        between a mistake and a public commit of somebody's key.
    #>
    param([Parameter(Mandatory)][AllowEmptyString()][string] $Body)

    if ([string]::IsNullOrWhiteSpace($Body)) { return @{ ok = $false; reason = 'empty body' } }
    if ($Body.Length -gt 2000) {
        return @{ ok = $false; reason = "body is $($Body.Length) characters, over the 2000 limit" }
    }
    if ($Body -match '(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|cob-key\.json|privateKey') {
        return @{ ok = $false; reason = 'body looks like it contains key material' }
    }
    return @{ ok = $true; reason = $null }
}

function Post-CommentReply {
    <#
        The only thing in the comment pass that writes to GitHub.

        Issue comments are flat, so a reply is a new comment on the same issue. Review comments
        are threaded, so they get a real reply endpoint.
    #>
    param(
        [Parameter(Mandatory)][string] $Repo,
        [Parameter(Mandatory)] $Comment,
        [Parameter(Mandatory)][string] $Body
    )

    $endpoint = if ($Comment.kind -eq 'review') {
        "repos/$Repo/pulls/$($Comment.pullNumber)/comments/$($Comment.id)/replies"
    } else {
        "repos/$Repo/issues/$($Comment.issueNumber)/comments"
    }

    $payloadFile = Join-Path ([System.IO.Path]::GetTempPath()) "cob-reply-$($Comment.id)-$PID.json"
    try {
        # --input rather than -f body=... because the body contains newlines and Markdown.
        (@{ body = $Body } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $payloadFile -Encoding utf8
        $response = & gh api -X POST $endpoint --input $payloadFile 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{ ok = $false; reason = ([string]$response).Trim(); id = $null }
        }
        $parsed = $response | ConvertFrom-Json
        return @{ ok = $true; reason = $null; id = (Get-Field -Object $parsed -Name 'id') }
    } catch {
        return @{ ok = $false; reason = $_.Exception.Message; id = $null }
    } finally {
        Remove-Item -LiteralPath $payloadFile -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CommentPass {
    <#
        Read the repository's comments, ask the agent what to say, validate the answer, post it,
        and remember what was posted.

        The agent never touches GitHub. It writes one JSON file and stops; everything public
        goes through code that can be read and tested. This keeps the failure mode of a confused
        model to "wrote a bad reply that was rejected" rather than "did something to the
        repository".
    #>
    param(
        [Parameter(Mandatory)][string] $Repo,
        [Parameter(Mandatory)][string] $RepoRoot,
        [AllowEmptyString()][string] $DshPath = '',
        [Parameter(Mandatory)][string] $BriefPath,
        [Parameter(Mandatory)][string] $StateFile,
        [Parameter(Mandatory)][string] $PendingFile,
        [Parameter(Mandatory)][string] $RepliesFile,
        [int] $Max = 20,
        [switch] $DryRun
    )

    Write-Log 'comment responder'

    if (-not (Test-Path -LiteralPath $BriefPath)) {
        Write-Log "  brief not found at $BriefPath; skipping the comment pass" 'WARN'
        return @{ status = 'skipped'; replied = 0 }
    }

    # A pass that cannot read comments is not a failed maintenance pass.
    $null = & gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log '  gh is not authenticated; skipping the comment pass' 'WARN'
        return @{ status = 'skipped'; replied = 0 }
    }

    $self = & gh api user --jq '.login' 2>$null
    if (-not $self) {
        Write-Log '  could not determine the authenticated login; skipping the comment pass' 'WARN'
        return @{ status = 'skipped'; replied = 0 }
    }

    try {
        $state = Read-CommentState -Path $StateFile
    } catch {
        Write-Log "  the comment state file is unusable: $($_.Exception.Message)" 'ERROR'
        Write-Log '  refusing to post anything, so that no comment is answered twice' 'ERROR'
        return @{ status = 'error'; replied = 0 }
    }

    try {
        $comments = Get-RepositoryComments -Repo $Repo
    } catch {
        Write-Log "  could not fetch comments: $($_.Exception.Message)" 'WARN'
        return @{ status = 'error'; replied = 0 }
    }

    $selection = Select-PendingComments -Comments $comments -State $state -SelfLogin $self -Max $Max
    $pending = $selection.pending

    Write-Log ("  {0} comment(s) on the repository; {1} from this account or a bot, {2} already handled" -f `
        $comments.Count, $selection.skippedOwn, $selection.skippedSeen)

    if ($selection.capped -gt 0) {
        Write-Log "  $($selection.capped) more will wait for the next pass (cap: $Max)" 'WARN'
    }

    if ($pending.Count -eq 0) {
        Write-Log '  nothing to answer'
        return @{ status = 'idle'; replied = 0 }
    }

    $pending = Add-CommentTitles -Comments $pending -Repo $Repo

    if ($DryRun) {
        Write-Log "  dry run: $($pending.Count) comment(s) would be sent to the responder"
        foreach ($c in $pending) {
            Write-Log "    $($c.key)  by $($c.author)  $($c.url)"
        }
        return @{ status = 'dry-run'; replied = 0 }
    }

    if ([string]::IsNullOrWhiteSpace($DshPath)) {
        Write-Log '  no dsh launcher available; skipping the comment pass' 'ERROR'
        return @{ status = 'error'; replied = 0 }
    }

    ($pending | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $PendingFile -Encoding utf8
    Remove-Item -LiteralPath $RepliesFile -Force -ErrorAction SilentlyContinue

    $brief = Get-Content -LiteralPath $BriefPath -Raw
    $header = @"
COMMENT RESPONDER PASS
Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')
Repository: $Repo  (working copy: $RepoRoot)
Comments awaiting a reply: $PendingFile
Write your replies to: $RepliesFile

There are $($pending.Count) comment(s) to consider. Read the brief below and write the replies
file. Do not post anything: the runner posts for you, after validating what you wrote.

---
"@

    $agentExit = 0
    try {
        & $DshPath headless ($header + $brief) 2>&1 | Tee-Object -FilePath $PassLog -Append | ForEach-Object { Write-Host $_ }
        $agentExit = $LASTEXITCODE
    } catch {
        Write-Log "  the responder agent failed: $($_.Exception.Message)" 'WARN'
        $agentExit = 1
    }

    if ($agentExit -ne 0) {
        Write-Log '  the responder agent exited non-zero; nothing was posted' 'WARN'
        return @{ status = 'error'; replied = 0 }
    }

    if (-not (Test-Path -LiteralPath $RepliesFile)) {
        Write-Log '  the agent wrote no replies file; nothing was posted' 'WARN'
        return @{ status = 'error'; replied = 0 }
    }

    try {
        $result = (Get-Content -LiteralPath $RepliesFile -Raw) | ConvertFrom-Json
    } catch {
        Write-Log "  the replies file is not valid JSON: $($_.Exception.Message)" 'WARN'
        return @{ status = 'error'; replied = 0 }
    }

    $allowed = @{}
    foreach ($c in $pending) { $allowed[$c.key] = $c }

    $signature = "`n`n<sub>automated maintainer agent - [how this repository is maintained](https://github.com/$Repo/blob/main/agents/comment-responder/README.md)</sub>"

    $now = (Get-Date).ToString('o')
    $replied = 0
    $recorded = 0

    foreach ($entry in @(Get-Field -Object $result -Name 'replies' -Default @())) {
        $key = [string](Get-Field -Object $entry -Name 'key' -Default '')
        $body = [string](Get-Field -Object $entry -Name 'body' -Default '')

        $keyCheck = Test-ReplyKey -Key $key -Allowed $allowed
        if (-not $keyCheck.ok) { Write-Log "  dropped a reply: $($keyCheck.reason)" 'WARN'; continue }

        $bodyCheck = Test-ReplyBody -Body $body
        if (-not $bodyCheck.ok) { Write-Log "  dropped the reply to $key : $($bodyCheck.reason)" 'WARN'; continue }

        $comment = $allowed[$key]
        $posted = Post-CommentReply -Repo $Repo -Comment $comment -Body ($body.Trim() + $signature)

        if ($posted.ok) {
            $replied++
            $state.comments[$key] = [pscustomobject]@{
                updatedAtEpoch = $comment.updatedAtEpoch
                action         = 'replied'
                replyId        = $posted.id
                at             = $now
            }
            $recorded++
            Write-Log "  replied to $key (by $($comment.author))"
        } else {
            # Deliberately NOT recorded: an unposted reply must be retried next pass.
            Write-Log "  could not reply to $key : $($posted.reason)" 'WARN'
        }
    }

    $skippedCount = 0
    foreach ($entry in @(Get-Field -Object $result -Name 'skipped' -Default @())) {
        $key = [string](Get-Field -Object $entry -Name 'key' -Default '')
        $reason = [string](Get-Field -Object $entry -Name 'reason' -Default '')

        $keyCheck = Test-ReplyKey -Key $key -Allowed $allowed
        if (-not $keyCheck.ok) { Write-Log "  dropped a skip entry: $($keyCheck.reason)" 'WARN'; continue }

        $comment = $allowed[$key]
        $state.comments[$key] = [pscustomobject]@{
            updatedAtEpoch = $comment.updatedAtEpoch
            action         = 'skipped'
            reason         = $reason
            at             = $now
        }
        $recorded++
        $skippedCount++
    }

    $unaccounted = @($pending | Where-Object { -not $state.comments.ContainsKey($_.key) })
    if ($unaccounted.Count -gt 0) {
        Write-Log "  $($unaccounted.Count) comment(s) were neither answered nor skipped; they will be offered again" 'WARN'
        foreach ($c in $unaccounted) { Write-Log "    $($c.key)" 'WARN' }
    }

    if ($recorded -gt 0) { Save-CommentState -Path $StateFile -State $state }

    Write-Log "  $replied repl(y/ies) posted, $skippedCount skipped"
    return @{ status = 'ran'; replied = $replied }
}

# ---------------------------------------------------------------- last resort

# An unattended pass must never die silently.
#
# The first properly scheduled run failed two seconds in and left four lines in its log and
# nothing at all in result.txt: `git` had disappeared from PATH, the first command that needed it
# threw, and the error went to a console nobody was watching. The directory listed in result.txt
# is the operator's only summary, so an empty one is worse than a wrong one - it looks like the
# pass simply never ran.
#
# Everything from here on is covered by this trap.
trap {
    $reason = $_.Exception.Message
    try {
        Write-Log ''
        Write-Log 'UNHANDLED ERROR - the pass stopped here' 'ERROR'
        Write-Log "  $reason" 'ERROR'
        if ($_.ScriptStackTrace) { Write-Log "  $($_.ScriptStackTrace)" 'ERROR' }
        Write-Log '  the lines above are the last steps that succeeded' 'ERROR'

        # result.txt is read at a glance, so the verdict stays short; the full reason is in the
        # pass log, which the verdict points at.
        $short = if ($reason.Length -gt 90) { $reason.Substring(0, 87) + '...' } else { $reason }
        Write-Result -Verdict "echec (erreur non geree : $short, voir le pass-log)"
    } catch {
        # Nothing useful left to do. The exit code still reports the failure.
    }
    exit 1
}

Write-Log "communityofbillions maintenance pass"
Write-Log "repository : $RepoPath"
Write-Log "log        : $PassLog"
Write-Log "agent log  : $LogDir"

# ---------------------------------------------------------------- preflight

Push-Location $RepoPath
try {
    if (-not (Test-Path (Join-Path $RepoPath 'agents/maintenance/pass.md'))) {
        throw "maintenance brief not found at agents/maintenance/pass.md; is this the right repository?"
    }

    # Checked explicitly so that a missing tool produces a sentence rather than a stack trace.
    foreach ($tool in 'git', 'node', 'gh') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "$tool is not on PATH, and every pass needs it. The launcher repairs the usual Git locations; if this persists, fix PATH for the account the task runs as."
        }
    }

    $dirtyBefore = git status --porcelain
    if ($dirtyBefore) {
        Write-Log "the working tree was already dirty before this pass:" 'WARN'
        $dirtyBefore | ForEach-Object { Write-Log "  $_" 'WARN' }
    }

    Write-Log 'pulling'
    git pull --rebase --autostash 2>&1 | ForEach-Object { Write-Log "  $_" }

    # ------------------------------------------------------------ gates only

    if ($CheckGates) {
        Write-Log 'running the quality gates only (-CheckGates); no agent will be invoked'
        $gatesOk = Test-Gates -RepoRoot $RepoPath
        Write-Index ("gates {0}" -f $(if ($gatesOk) { 'PASS' } else { 'FAIL' }))
        exit $(if ($gatesOk) { 0 } else { 1 })
    }

    # ------------------------------------------------------------ comments only

    if ($CommentsOnly) {
        $slug = Get-RepositorySlug -RepoRoot $RepoPath
        if (-not $slug) {
            Write-Log 'could not determine the repository from the git remote' 'ERROR'
            exit 2
        }
        $onlyDsh = Resolve-DshCommand
        $only = Invoke-CommentPass -Repo $slug -RepoRoot $RepoPath -DshPath $onlyDsh `
            -BriefPath $CommentBriefPath -StateFile $CommentStateFile `
            -PendingFile $PendingFile -RepliesFile $RepliesFile -DryRun:$DryRun
        Write-Index ("comments-only {0} replied={1}" -f $only.status, $only.replied)
        exit 0
    }

    # ------------------------------------------------------------ locate the agent

    # Resolved before the dry-run branch so that a dry run actually proves the thing most
    # likely to be broken in an unattended context.
    $dshPath = Resolve-DshCommand
    if (-not $dshPath) {
        Write-Log 'could not find the dsh launcher in any known location.' 'ERROR'
        Write-Log '  set $env:COB_DSH to its full path, or install it globally:' 'ERROR'
        Write-Log '    npm install -g @deepseek-ai/dsh' 'ERROR'
        Write-Index 'ERROR dsh not found'
        exit 2
    }
    Write-Log "agent      : $dshPath"

    # Remember it, so the next run is deterministic even if PATH changes.
    Set-Content -Path (Join-Path $LogDir 'dsh-path.txt') -Value $dshPath -Encoding utf8 -NoNewline

    if ($dshPath -match '_npx') {
        Write-Log 'note: this is an npx-cached copy. Working, but npm may prune it.' 'WARN'
        Write-Log '      To make it permanent: npm install -g @deepseek-ai/dsh' 'WARN'
    }

    # ------------------------------------------------------------ prompt

    $brief = Get-Content -Path (Join-Path $RepoPath 'agents/maintenance/pass.md') -Raw

    $header = @"
SCHEDULED MAINTENANCE PASS
Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')
Repository: $RepoPath
Log directory: $LogDir

You are running unattended. There is no human to ask. Read the brief below and carry out
exactly one pass. When a decision is not yours to make, open an issue and stop.

---
"@

    $prompt = $header + $brief

    if ($DryRun) {
        Write-Log 'dry run: the following prompt would be sent'
        Write-Host ''
        Write-Host $prompt
        Write-Host ''
        Write-Log 'dry run complete, nothing was invoked'
        Write-Index "dry-run"
        return
    }

    # ------------------------------------------------------------ run

    Write-Log 'invoking the agent (this can take a while)'
    $headBeforeAgent = (git rev-parse --short HEAD)
    $started = Get-Date
    $agentExit = 0
    try {
        & $dshPath headless $prompt 2>&1 | Tee-Object -FilePath $PassLog -Append | ForEach-Object { Write-Host $_ }
        $agentExit = $LASTEXITCODE
    } catch {
        Write-Log "the agent invocation failed: $($_.Exception.Message)" 'ERROR'
        $agentExit = 1
    }
    $elapsed = (Get-Date) - $started
    Write-Log ("agent finished with exit code {0} after {1:hh\:mm\:ss}" -f $agentExit, $elapsed)

    # ------------------------------------------------------------ ensure nothing is left behind

    $head = (git rev-parse --short HEAD)
    if (-not $NoPush) {
        git push 2>&1 | ForEach-Object { Write-Log "  $_" }
    }

    $dirty = git status --porcelain
    $leftoverCommitted = $false

    if ($dirty) {
        Write-Log 'the agent left uncommitted changes:' 'WARN'
        $dirty | ForEach-Object { Write-Log "  $_" 'WARN' }

        Write-Log 'checking whether the leftover work passes the gates'
        $gatesOk = Test-Gates -RepoRoot $RepoPath

        if ($gatesOk) {
            Write-Log 'gates pass; committing the leftover work so nothing stays local'
            git add -A
            git commit -m "agents: leftovers from scheduled pass $Stamp" 2>&1 | ForEach-Object { Write-Log "  $_" }
            if (-not $NoPush) {
                git push 2>&1 | ForEach-Object { Write-Log "  $_" }
            }
            $leftoverCommitted = $true
        } else {
            Write-Log 'gates FAIL; leaving the working tree untouched for a human to inspect' 'ERROR'
        }
    }

    # ------------------------------------------------------------ report

    $finalHead = (git rev-parse --short HEAD)
    $log = git log --oneline -1

    Write-Log ''
    Write-Log 'pass summary'
    Write-Log "  agent exit code : $agentExit"
    Write-Log "  head before     : $head"
    Write-Log "  head after      : $finalHead"
    Write-Log "  last commit     : $log"
    Write-Log "  leftovers       : $(if ($dirty) { if ($leftoverCommitted) { 'committed and pushed' } else { 'LEFT DIRTY - human attention needed' } } else { 'none' })"

    Write-Index ("pass complete head={0} agentExit={1} leftovers={2}" -f $finalHead, $agentExit, $(if (-not $dirty) { 'none' } elseif ($leftoverCommitted) { 'committed' } else { 'DIRTY' }))

    # ------------------------------------------------------------ comment responder

    # Runs after the code work, so a reply can refer to what this pass actually just landed.
    # A failure here never fails the maintenance pass: reading comments is a courtesy to
    # visitors, not a precondition for the repository being maintained.
    $commentResult = @{ status = 'skipped'; replied = 0 }
    $slug = Get-RepositorySlug -RepoRoot $RepoPath
    if ($slug) {
        $commentResult = Invoke-CommentPass -Repo $slug -RepoRoot $RepoPath -DshPath $dshPath `
            -BriefPath $CommentBriefPath -StateFile $CommentStateFile `
            -PendingFile $PendingFile -RepliesFile $RepliesFile
    } else {
        Write-Log 'could not determine the repository from the git remote; skipping the comment pass' 'WARN'
    }

    # ------------------------------------------------------------ verdict

    # One line, for a human. Accents are avoided here on purpose: this string travels through
    # a log file, a terminal, and possibly a copy-paste, and a mojibake verdict is worse than
    # an unaccented one.
    $verdict = if ($agentExit -ne 0) {
        "echec (l'agent a quitte en code $agentExit)"
    } elseif ($dirty -and -not $leftoverCommitted) {
        'echec (les portes echouent, arbre laisse en place)'
    } elseif ($finalHead -eq $headBeforeAgent) {
        'ok (rien a faire)'
    } else {
        'ok'
    }

    if ($commentResult.replied -gt 0) {
        $verdict += " (+$($commentResult.replied) reponse(s))"
    }

    Write-Result -Verdict $verdict

    exit $agentExit
} finally {
    Pop-Location
}
