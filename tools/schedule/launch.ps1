#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Starts the maintenance runner under PowerShell 7, from an interpreter Task Scheduler can
    actually launch.

.DESCRIPTION
    This script exists because of one specific trap.

    PowerShell 7 installed from the Microsoft Store is reachable on PATH only through a
    **0-byte app execution alias** in %LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe. That alias
    works perfectly from an interactive shell and fails with ERROR_FILE_NOT_FOUND (0x80070002)
    when Windows Task Scheduler tries to start it directly as a task action. The task is
    created successfully, reports itself as Ready, fires on schedule, and fails in
    milliseconds with no visible reason.

    The one interpreter whose path cannot move is Windows PowerShell 5.1, at
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe. So that is what the scheduled
    task runs: 5.1 starts this script, this script finds a real PowerShell 7, and hands the
    work over. If no PowerShell 7 exists, it says so and runs the runner under 5.1 anyway,
    because a pass under a slightly older shell beats no pass at all.

.PARAMETER RunnerPath
    The script to hand over to. Defaults to run-pass.ps1 beside this file.

.PARAMETER RunnerArgs
    Anything else on the command line is forwarded to the runner.

.PARAMETER FindOnly
    Print the PowerShell 7 path that would be used and exit, without running anything. Exit code
    1 means no usable PowerShell 7 was found. The installer uses this so that a broken launcher
    is discovered at install time rather than on the first unattended run.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\schedule\launch.ps1

.EXAMPLE
    # check what the task would start, without starting a pass
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\schedule\launch.ps1 -FindOnly

.EXAMPLE
    # forwarded arguments, e.g. for a rehearsal
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\schedule\launch.ps1 -CheckGates
#>
[CmdletBinding()]
param(
    [string] $RunnerPath,
    [switch] $FindOnly,
    [Parameter(ValueFromRemainingArguments = $true)][string[]] $RunnerArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# $PSScriptRoot is NOT populated inside a param() default block when the script declares
# [CmdletBinding()] and is started by Windows PowerShell 5.1 — which is exactly how the
# scheduled task starts this file. Resolving it here instead is the difference between a task
# that runs and one that dies at parameter binding. This is verified behaviour, not folklore:
# the same script without [CmdletBinding()] binds $PSScriptRoot correctly.
if ([string]::IsNullOrWhiteSpace($RunnerPath)) {
    $RunnerPath = Join-Path $PSScriptRoot 'run-pass.ps1'
}

function Find-PowerShell7 {
    <#
        Return the full path to a pwsh.exe that can actually be executed, or $null.

        The 0-byte check is the important part. A file of length zero named pwsh.exe is the app
        execution alias, and handing that path to Task Scheduler or to Start-Process reproduces
        the original failure. Only a real binary will do.
    #>
    $candidates = @()

    # 1. A conventional install. The stable path, if anyone ever installs it properly.
    $candidates += 'C:\Program Files\PowerShell\7\pwsh.exe'
    $candidates += 'C:\Program Files\PowerShell\7-preview\pwsh.exe'

    # 2. The Microsoft Store package, located through the package registry rather than by
    #    guessing the version-stamped folder name, so that a PowerShell update does not
    #    silently break the scheduled task.
    try {
        $packages = @(Get-AppxPackage -Name 'Microsoft.PowerShell' -ErrorAction SilentlyContinue)
        foreach ($package in $packages) {
            $location = $package.InstallLocation
            if ($location) { $candidates += (Join-Path $location 'pwsh.exe') }
        }
    } catch {
        # Get-AppxPackage is unavailable in some minimal environments. The next step covers it.
    }

    # 3. Last resort: the filesystem, newest first.
    try {
        $candidates += @(Get-ChildItem -Path 'C:\Program Files\WindowsApps\Microsoft.PowerShell_*_x64__8wekyb3d8bbwe\pwsh.exe' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -ExpandProperty FullName)
    } catch {
    }

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        $item = Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue
        if ($item -and $item.Length -gt 0) { return $candidate }
    }

    return $null
}

$pwsh = Find-PowerShell7

if ($FindOnly) {
    if ($pwsh) { Write-Output $pwsh; exit 0 }
    exit 1
}

if (-not (Test-Path -LiteralPath $RunnerPath)) {
    Write-Error "the maintenance runner was not found at '$RunnerPath'"
    exit 2
}

if ($pwsh) {
    # Already running the right shell? Do not spend a second process on it.
    $current = $null
    try { $current = (Get-Process -Id $PID).Path } catch { }

    if ($current -and $current -eq $pwsh) {
        & $RunnerPath @RunnerArgs
        exit $LASTEXITCODE
    }

    & $pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $RunnerPath @RunnerArgs
    exit $LASTEXITCODE
}

Write-Warning 'No PowerShell 7 was found; running the maintenance pass under Windows PowerShell 5.1.'
Write-Warning 'Some steps may behave differently. Install PowerShell 7 to avoid this.'
& $RunnerPath @RunnerArgs
exit $LASTEXITCODE
