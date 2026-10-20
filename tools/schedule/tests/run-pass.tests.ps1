#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Tests for the maintenance runner's pure logic.

.DESCRIPTION
    There is no Pester here on purpose: this repository has zero dependencies and the runner is
    a single script. A small assertion helper is enough, and it means these tests run anywhere
    pwsh runs, on any machine, with nothing installed.

    The functions under test are extracted from run-pass.ps1 with the PowerShell AST and then
    invoked. That is deliberate: it means the tests exercise the code that actually ships,
    rather than a copy that can drift away from it.

    What is covered here is the decision logic — which comments are worth answering, what may be
    posted, and how the record of what has been answered is kept. The parts that talk to GitHub
    need a network and an account, and are exercised by running the pass for real.

.EXAMPLE
    pwsh tools/schedule/tests/run-pass.tests.ps1
#>
[CmdletBinding()]
param(
    [string] $RunnerPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolved in the body, not in the param() default: under Windows PowerShell 5.1 a script that
# declares [CmdletBinding()] binds $PSScriptRoot as an empty string in its parameter defaults.
if ([string]::IsNullOrWhiteSpace($RunnerPath)) {
    $RunnerPath = Join-Path $PSScriptRoot '..' 'run-pass.ps1'
}

$script:Passed = 0
$script:Failed = 0

function Assert-That {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][bool] $Condition,
        [string] $Detail = ''
    )
    if ($Condition) {
        $script:Passed++
        Write-Host "  ok   $Name"
    } else {
        $script:Failed++
        Write-Host "  FAIL $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "         $Detail" -ForegroundColor Red }
    }
}

function New-TestComment {
    param(
        [string] $Key = 'issue:1',
        [string] $Author = 'alice',
        [string] $AuthorType = 'User',
        [AllowNull()][string] $AppSlug = $null,
        [int64] $UpdatedAt = 1000
    )
    [pscustomobject]@{
        key            = $Key
        kind           = 'issue'
        id             = 1
        author         = $Author
        authorType     = $AuthorType
        appSlug        = $AppSlug
        body           = 'a comment'
        createdAtEpoch = 1
        updatedAtEpoch = $UpdatedAt
        url            = 'https://example.invalid'
        issueNumber    = 1
        pullNumber     = $null
        title          = 'a title'
    }
}

function New-TestState {
    param([hashtable] $Comments = @{})
    @{ version = 1; updated = $null; comments = $Comments }
}

function New-SeenEntry {
    param([int64] $UpdatedAtEpoch = 1000, [string] $Action = 'replied')
    [pscustomobject]@{ updatedAtEpoch = $UpdatedAtEpoch; action = $Action; at = '2026-01-01T00:00:00Z' }
}

# ---------------------------------------------------------------- load the code under test

$resolvedRunner = (Resolve-Path -LiteralPath $RunnerPath).Path
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($resolvedRunner, [ref]$null, [ref]$parseErrors)

if ($parseErrors -and $parseErrors.Count -gt 0) {
    Write-Host "run-pass.ps1 does not parse; cannot test it:" -ForegroundColor Red
    $parseErrors | ForEach-Object { Write-Host "  line $($_.Extent.StartLineNumber): $($_.Message)" }
    exit 1
}

$wanted = @(
    'Get-Field',
    'Select-PendingComments',
    'Test-ReplyKey',
    'Test-ReplyBody',
    'Read-CommentState',
    'Save-CommentState',
    'Resolve-CredentialDocument',
    'Get-ManagedCredential',
    'Import-LaunchCredentials'
)

foreach ($name in $wanted) {
    $found = $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)

    if ($found.Count -eq 0) {
        Write-Host "run-pass.ps1 no longer defines '$name'; this test file needs updating" -ForegroundColor Red
        exit 1
    }
    Invoke-Expression $found[0].Extent.Text
}

Write-Host "testing $resolvedRunner"
Write-Host ''

# ---------------------------------------------------------------- Get-Field

Write-Host 'Get-Field'
$subject = [pscustomobject]@{ present = 'yes' }
Assert-That 'reads a property that exists' ((Get-Field -Object $subject -Name 'present') -eq 'yes')
Assert-That 'returns null for a property that does not' ($null -eq (Get-Field -Object $subject -Name 'absent'))
Assert-That 'returns the default for a missing property' ((Get-Field -Object $subject -Name 'absent' -Default 'fallback') -eq 'fallback')
Assert-That 'returns the default for a null object' ((Get-Field -Object $null -Name 'anything' -Default 'fallback') -eq 'fallback')

# ---------------------------------------------------------------- Select-PendingComments

Write-Host ''
Write-Host 'Select-PendingComments'

$result = Select-PendingComments -Comments @(New-TestComment -Author 'withinaz') -State (New-TestState) -SelfLogin 'withinaz'
Assert-That 'a comment from our own account is never pending' ($result.pending.Count -eq 0)
Assert-That 'and it is counted as ours' ($result.skippedOwn -eq 1)

$result = Select-PendingComments -Comments @(New-TestComment -Author 'dependabot' -AuthorType 'Bot') -State (New-TestState) -SelfLogin 'withinaz'
Assert-That 'a bot comment is never pending' ($result.pending.Count -eq 0)

$result = Select-PendingComments -Comments @(New-TestComment -Author 'someapp' -AppSlug 'some-app') -State (New-TestState) -SelfLogin 'withinaz'
Assert-That 'a comment posted through a GitHub App is never pending' ($result.pending.Count -eq 0)

$result = Select-PendingComments -Comments @(New-TestComment -Key 'issue:7' -UpdatedAt 1000) -State (New-TestState) -SelfLogin 'withinaz'
Assert-That 'a comment we have never seen is pending' ($result.pending.Count -eq 1)
Assert-That 'and it is the right one' ($result.pending[0].key -eq 'issue:7')

$seen = New-TestState -Comments @{ 'issue:7' = (New-SeenEntry -UpdatedAtEpoch 1000) }
$result = Select-PendingComments -Comments @(New-TestComment -Key 'issue:7' -UpdatedAt 1000) -State $seen -SelfLogin 'withinaz'
Assert-That 'a comment we have already handled, unchanged, is NOT pending' ($result.pending.Count -eq 0)
Assert-That 'and it is counted as already handled' ($result.skippedSeen -eq 1)

$result = Select-PendingComments -Comments @(New-TestComment -Key 'issue:7' -UpdatedAt 2000) -State $seen -SelfLogin 'withinaz'
Assert-That 'a comment EDITED since we handled it is pending again' ($result.pending.Count -eq 1)

$result = Select-PendingComments -Comments @(New-TestComment -Key 'issue:7' -UpdatedAt 999) -State $seen -SelfLogin 'withinaz'
Assert-That 'a comment whose timestamp went backwards is not re-answered' ($result.pending.Count -eq 0)

$result = Select-PendingComments -Comments @(
    (New-TestComment -Key 'issue:3' -UpdatedAt 3000),
    (New-TestComment -Key 'issue:1' -UpdatedAt 1000),
    (New-TestComment -Key 'issue:2' -UpdatedAt 2000)
) -State (New-TestState) -SelfLogin 'withinaz'
$order = ($result.pending | ForEach-Object { $_.key }) -join ','
Assert-That 'pending comments are ordered oldest first' ($order -eq 'issue:1,issue:2,issue:3') "got: $order"

$many = 1..12 | ForEach-Object { New-TestComment -Key "issue:$_" -UpdatedAt $_ }
$result = Select-PendingComments -Comments $many -State (New-TestState) -SelfLogin 'withinaz' -Max 5
Assert-That 'the per-pass cap is applied' ($result.pending.Count -eq 5)
Assert-That 'and the overflow is reported' ($result.capped -eq 7)
Assert-That 'the cap keeps the oldest, not the newest' ($result.pending[0].key -eq 'issue:1')

$result = Select-PendingComments -Comments @() -State (New-TestState) -SelfLogin 'withinaz'
Assert-That 'an empty repository yields nothing pending' ($result.pending.Count -eq 0)

# ---------------------------------------------------------------- Test-ReplyKey

Write-Host ''
Write-Host 'Test-ReplyKey'

$allowed = @{ 'issue:1' = (New-TestComment -Key 'issue:1') }
Assert-That 'a key from the input is accepted' ((Test-ReplyKey -Key 'issue:1' -Allowed $allowed).ok)
Assert-That 'an empty key is refused' (-not (Test-ReplyKey -Key '' -Allowed $allowed).ok)
Assert-That 'a key that was not in the input is refused' (-not (Test-ReplyKey -Key 'issue:99' -Allowed $allowed).ok)
Assert-That 'a bare numeric id is refused' (-not (Test-ReplyKey -Key '1' -Allowed $allowed).ok)

# ---------------------------------------------------------------- Test-ReplyBody

Write-Host ''
Write-Host 'Test-ReplyBody'

Assert-That 'an ordinary reply is accepted' ((Test-ReplyBody -Body 'Yes, that is a real bug. Not fixed yet.').ok)
Assert-That 'an empty reply is refused' (-not (Test-ReplyBody -Body '').ok)
Assert-That 'a whitespace-only reply is refused' (-not (Test-ReplyBody -Body "   `n  ").ok)
Assert-That 'an over-long reply is refused' (-not (Test-ReplyBody -Body ('x' * 2001)).ok)
Assert-That 'a reply of exactly the limit is accepted' ((Test-ReplyBody -Body ('x' * 2000)).ok)
Assert-That 'a reply containing a private key header is refused' (
    -not (Test-ReplyBody -Body "here you go`n-----BEGIN OPENSSH PRIVATE KEY-----`nabc").ok
)
Assert-That 'a reply containing a GitHub token is refused' (
    -not (Test-ReplyBody -Body 'use ghp_abcdefghijklmnopqrstuvwxyz012345 to push').ok
)
Assert-That 'a reply mentioning cob-key.json is refused' (
    -not (Test-ReplyBody -Body 'your cob-key.json is in the wrong place').ok
)

# ---------------------------------------------------------------- state round trip

Write-Host ''
Write-Host 'Comment state'

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cob-state-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$stateFile = Join-Path $tempDir 'answered-comments.json'

try {
    $fresh = Read-CommentState -Path $stateFile
    Assert-That 'a missing state file reads as empty' ($fresh.comments.Count -eq 0)
    Assert-That 'and carries a version' ($fresh.version -eq 1)

    $state = New-TestState -Comments @{ 'issue:7' = (New-SeenEntry -UpdatedAtEpoch 1234) }
    Save-CommentState -Path $stateFile -State $state
    Assert-That 'the state file is written' (Test-Path -LiteralPath $stateFile)

    $reloaded = Read-CommentState -Path $stateFile
    Assert-That 'a saved entry survives the round trip' ($reloaded.comments.ContainsKey('issue:7'))
    Assert-That 'with its timestamp intact' ([int64]$reloaded.comments['issue:7'].updatedAtEpoch -eq 1234)
    Assert-That 'and its action' ($reloaded.comments['issue:7'].action -eq 'replied')

    $blankFile = Join-Path $tempDir 'blank.json'
    Set-Content -LiteralPath $blankFile -Value '   ' -Encoding utf8
    Assert-That 'a blank state file reads as empty rather than throwing' ((Read-CommentState -Path $blankFile).comments.Count -eq 0)

    $brokenFile = Join-Path $tempDir 'broken.json'
    Set-Content -LiteralPath $brokenFile -Value '{ this is not json' -Encoding utf8
    $threw = $false
    try { $null = Read-CommentState -Path $brokenFile } catch { $threw = $true }
    Assert-That 'a corrupt state file throws, so the caller can fail closed' $threw

    # The behaviour that matters: a corrupt state must stop the pass, not silently re-answer.
    # This asserts the contract the caller relies on.
    $roundTripState = New-TestState -Comments @{ 'issue:1' = (New-SeenEntry -UpdatedAtEpoch 5000) }
    Save-CommentState -Path $stateFile -State $roundTripState
    $again = Select-PendingComments -Comments @(New-TestComment -Key 'issue:1' -UpdatedAt 5000) `
        -State (Read-CommentState -Path $stateFile) -SelfLogin 'withinaz'
    Assert-That 'a comment recorded as handled is not offered again after a reload' ($again.pending.Count -eq 0)
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- credentials

# `dsh headless` disables the harness credentials plugin on purpose ("one-shot jobs use
# launch-time credentials instead of the interactive store"), so the runner has to lift the
# stored reference into its own environment. These assertions cover the reader, because the
# failure it prevents is expensive and quiet: a pass that pulls, logs its header, waits
# forty-seven seconds and then reports an opaque MISSING_CREDENTIAL.

Write-Host ''
Write-Host 'Resolve-CredentialDocument'

Assert-That 'an explicit harness home wins' `
    ((Resolve-CredentialDocument -DshHome 'C:\harness') -eq 'C:\harness\.credentials.yaml')

$previousDshHome = $env:DSH_HOME
try {
    $env:DSH_HOME = 'C:\from-env'
    Assert-That 'otherwise $DSH_HOME decides' `
        ((Resolve-CredentialDocument) -eq 'C:\from-env\.credentials.yaml')
    Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
    $resolved = Resolve-CredentialDocument
    Assert-That 'and with neither set it falls back to the user profile' ($resolved -like '*\.dsh\.credentials.yaml')
} finally {
    if ($previousDshHome) { $env:DSH_HOME = $previousDshHome }
    else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host 'Get-ManagedCredential'

$credDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cob-cred-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $credDir | Out-Null
$credFile = Join-Path $credDir '.credentials.yaml'

try {
    $document = @"
version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: not-an-api-key
refs:
  # a comment inside the section is not an entry
  # ANOTHER_KEY: commented-out
  DEEPSEEK_API_KEY: sk-value-from-the-store
  COB_TEST_CREDENTIAL: sk-lifted-into-the-environment
  QUOTED_KEY: "sk-quoted"
"@
    Set-Content -LiteralPath $credFile -Value $document -Encoding utf8

    Assert-That 'reads a reference out of the refs section' `
        ((Get-ManagedCredential -Ref 'DEEPSEEK_API_KEY' -Path $credFile) -eq 'sk-value-from-the-store')
    Assert-That 'and strips a hand-edited quoted value' `
        ((Get-ManagedCredential -Ref 'QUOTED_KEY' -Path $credFile) -eq 'sk-quoted')
    Assert-That 'a commented-out entry is not a value' `
        ($null -eq (Get-ManagedCredential -Ref 'ANOTHER_KEY' -Path $credFile))
    Assert-That 'a reference that is not stored reads as absent' `
        ($null -eq (Get-ManagedCredential -Ref 'SOME_OTHER_KEY' -Path $credFile))
    Assert-That 'a grants record is not a reference' `
        ($null -eq (Get-ManagedCredential -Ref 'browser-session' -Path $credFile))
    Assert-That 'a missing document reads as absent rather than throwing' `
        ($null -eq (Get-ManagedCredential -Ref 'DEEPSEEK_API_KEY' -Path (Join-Path $credDir 'nope.yaml')))

    # An empty value is an absent credential: sending "" to the provider would fail later and
    # less clearly than reporting that nothing is stored.
    $emptyFile = Join-Path $credDir 'empty.yaml'
    Set-Content -LiteralPath $emptyFile -Value @('version: 1', 'refs:', '  EMPTY_KEY:') -Encoding utf8
    Assert-That 'an empty value reads as absent' `
        ($null -eq (Get-ManagedCredential -Ref 'EMPTY_KEY' -Path $emptyFile))

    # The point of the whole exercise: the runner turns the stored value into launch-time
    # environment for the headless agent, and the value never reaches a log line.
    Write-Host ''
    Write-Host 'Import-LaunchCredentials'

    $script:credLog = @()
    function Write-Log {
        param([string] $Message, [string] $Level = 'INFO')
        $script:credLog += [pscustomobject]@{ message = $Message; level = $Level }
    }

    $env:DSH_HOME = $credDir
    Remove-Item Env:COB_TEST_CREDENTIAL -ErrorAction SilentlyContinue
    Import-LaunchCredentials -Refs @('COB_TEST_CREDENTIAL')
    Assert-That 'the stored value reaches the process environment' `
        ($env:COB_TEST_CREDENTIAL -eq 'sk-lifted-into-the-environment')
    Assert-That 'the log names the reference' `
        (($script:credLog.message -join "`n") -like '*COB_TEST_CREDENTIAL from the managed store*')
    Assert-That 'and never carries the value' `
        (($script:credLog | ConvertTo-Json -Compress) -notlike '*sk-lifted-into-the-environment*')

    # An environment that already has the key wins: that is the documented override, and it
    # must not be silently replaced by an older stored value.
    $env:COB_TEST_CREDENTIAL = 'sk-from-the-launching-environment'
    Import-LaunchCredentials -Refs @('COB_TEST_CREDENTIAL')
    Assert-That 'an exported value is left alone' `
        ($env:COB_TEST_CREDENTIAL -eq 'sk-from-the-launching-environment')
    Assert-That 'and reported as coming from the environment' `
        (($script:credLog[-1].message) -like '*from the launching environment*')

    # Absent everywhere: a warning, not a throw. A pass that cannot find the key still has to
    # run the gates and write its verdict rather than collapse before it starts.
    Remove-Item Env:COB_ABSENT_CREDENTIAL -ErrorAction SilentlyContinue
    $script:credLog = @()
    Import-LaunchCredentials -Refs @('COB_ABSENT_CREDENTIAL')
    Assert-That 'a credential that exists nowhere warns instead of throwing' `
        (@($script:credLog | Where-Object { $_.level -eq 'WARN' }).Count -ge 1)
    Assert-That 'and leaves the environment untouched' `
        (-not (Test-Path Env:COB_ABSENT_CREDENTIAL))
} finally {
    Remove-Item Env:COB_TEST_CREDENTIAL -ErrorAction SilentlyContinue
    Remove-Item Env:COB_ABSENT_CREDENTIAL -ErrorAction SilentlyContinue
    if ($previousDshHome) { $env:DSH_HOME = $previousDshHome }
    else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $credDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- result

Write-Host ''
if ($script:Failed -eq 0) {
    Write-Host "$($script:Passed)/$($script:Passed) assertions passed" -ForegroundColor Green
    exit 0
}

Write-Host "$($script:Passed) passed, $($script:Failed) FAILED" -ForegroundColor Red
exit 1
