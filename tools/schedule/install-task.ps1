#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Registers the communityofbillions maintenance task in Windows Task Scheduler.

.DESCRIPTION
    Creates (or replaces) a scheduled task that runs one maintenance pass on Monday, Wednesday,
    and Friday at 09:00 local time.

    The task runs as the current user, interactively, and stores no password. That means it only
    runs while you are logged on — which is also what makes it safe: the agent needs your GitHub
    credentials from the credential store, and it has no business acting as a background service.

    Windows will start a missed run as soon as the machine is available (StartWhenAvailable),
    so a laptop that was asleep at 09:00 still gets its pass later the same day.

.PARAMETER At
    Time of day for each run, 24-hour HH:mm. Default 09:00.

.PARAMETER Days
    Days of the week. Default Monday, Wednesday, Friday.

.PARAMETER TimeoutHours
    Hard limit on a single pass. Default 2 hours.

.EXAMPLE
    pwsh tools/schedule/install-task.ps1
    pwsh tools/schedule/install-task.ps1 -At 07:30 -Days Monday,Thursday

.NOTES
    Unregister with:
        Unregister-ScheduledTask -TaskName communityofbillions-maintenance -Confirm:$false
#>
[CmdletBinding()]
param(
    [string] $At = '09:00',
    [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
    [string[]] $Days = @('Monday', 'Wednesday', 'Friday'),
    [int] $TimeoutHours = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'communityofbillions-maintenance'
$Runner = (Resolve-Path (Join-Path $PSScriptRoot 'run-pass.ps1')).Path
$Launcher = (Resolve-Path (Join-Path $PSScriptRoot 'launch.ps1')).Path
$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path

# The task is started by Windows PowerShell 5.1, whose path is in System32 and cannot move, and
# which hands over to launch.ps1. Registering the task as "pwsh.exe" instead looks correct, is
# accepted by Task Scheduler, reports itself as Ready, fires on schedule, and then fails in
# milliseconds with 0x80070002 — because a Store-installed PowerShell 7 is only reachable
# through a 0-byte app execution alias that an unattended start cannot resolve.
$SystemPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $SystemPowerShell)) {
    throw "Windows PowerShell was not found at '$SystemPowerShell'; this machine is not in a state this script understands"
}

# Ask the launcher what it would start. Doing the detection in one place means the installer
# exercises the exact code path an unattended run will take, instead of a copy that can drift.
$detected = (& $SystemPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Launcher -FindOnly 2>&1 | Out-String).Trim()

Write-Host "Task name : $TaskName"
Write-Host "Launcher  : $Launcher"
Write-Host "Started by: $SystemPowerShell"
Write-Host "Repository: $RepoPath"
Write-Host "Schedule  : $($Days -join ', ') at $At"
if ($detected) {
    Write-Host "PowerShell 7: $detected"
} else {
    Write-Warning 'The launcher found no PowerShell 7. The pass will run under Windows PowerShell 5.1.'
    Write-Warning 'It should still work, but install PowerShell 7 if you can.'
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'An existing task with this name will be replaced.'
}

$action = New-ScheduledTaskAction `
    -Execute $SystemPowerShell `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Launcher`"" `
    -WorkingDirectory $RepoPath

$triggers = foreach ($day in $Days) {
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek $day -At $At
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours $TimeoutHours) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 15)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description 'Runs one communityofbillions maintenance pass: pulls, invokes the maintenance agent, commits and pushes whatever it produced. See agents/maintenance/README.md.' `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host ''
Write-Host "Registered '$TaskName' (state: $($task.State))."
Write-Host "Next run: $($info.NextRunTime)"
Write-Host ''
Write-Host 'Triggers:'
foreach ($trigger in $task.Triggers) {
    Write-Host "  $($trigger.DaysOfWeek) at $($trigger.StartBoundary)"
}
Write-Host ''
Write-Host 'To test it immediately without waiting:'
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host 'To watch a run:'
Write-Host '  Get-ScheduledTaskInfo -TaskName communityofbillions-maintenance'
Write-Host '  Get-Content "$env:USERPROFILE\..\projects\communityofbillions-maintenance\logs\maintenance.log" -Tail 20'
