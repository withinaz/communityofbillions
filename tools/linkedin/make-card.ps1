#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Render a social card from a JSON spec, in this project's visual identity.

.DESCRIPTION
    Produces a 1200x1200 PNG (rendered at 2x, so 2400x2400) using headless Chrome. The layout
    is fixed and opinionated on purpose: the value of a card is that a reader recognises it as
    coming from the same place as the last one.

    A maintenance pass that wants a card writes a small JSON spec and calls this, rather than
    hand-writing HTML. Visual consistency that depends on an agent remembering last week's CSS
    is not consistency.

.PARAMETER Spec
    Path to the JSON spec. See -Example below and tools/linkedin/README.md.

.PARAMETER Out
    Where to write the PNG. Defaults to the spec path with a .png extension.

.PARAMETER ChromePath
    Override the browser. Detected from the usual install locations when omitted.

.EXAMPLE
    pwsh tools/linkedin/make-card.ps1 -Spec card.json -Out card.png

.NOTES
    Spec fields, all optional except the title:

      kicker         small uppercase line at the top
      titleLine1     first title line, plain
      titleLine2Lead second title line, de-emphasised
      titleLine2Accent second title line, highlighted
      sections       [{ "label": "...", "accent": false, "meta": "...", "rows": [{ "name", "role", "tag" }] }]
      mine           { "name", "role", "roleAccent" }  — the highlighted box
      quote          { "text", "source" }
      punch          final line
      punchAccent    final line, highlighted
      repo           right-hand side of the footer (may contain <br>)

    Values are inserted as HTML fragments. That is deliberate: the caller is this repository's own
    tooling, and the alternative — an escaping layer — would fight every arrow and ampersand.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Spec,
    [string] $Out,
    [string] $ChromePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Prop {
    <#
        Read a property that may not exist. Set-StrictMode Latest makes a missing property a
        terminating error, and every field of the spec past the title is optional.
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

function Find-Chrome {
    param([string] $Explicit)

    if ($Explicit) {
        if (-not (Test-Path -LiteralPath $Explicit)) { throw "Chrome was not found at '$Explicit'" }
        return $Explicit
    }

    $roots = @()
    if ($env:ProgramFiles) {
        $roots += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
        $roots += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    }
    if (${env:ProgramFiles(x86)}) {
        $roots += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
        $roots += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    }

    foreach ($candidate in $roots) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    throw 'No Chrome or Edge was found. Pass -ChromePath.'
}

# ---------------------------------------------------------------- paths

if (-not (Test-Path -LiteralPath $Spec)) { throw "spec not found at '$Spec'" }
$specPath = (Resolve-Path -LiteralPath $Spec).Path
if (-not $Out) { $Out = [System.IO.Path]::ChangeExtension($specPath, '.png') }
$outPath = [System.IO.Path]::GetFullPath($Out)

$chrome = Find-Chrome -Explicit $ChromePath

# ---------------------------------------------------------------- spec

$card = Get-Content -LiteralPath $specPath -Raw | ConvertFrom-Json

$kicker = [string](Get-Prop -Object $card -Name 'kicker' -Default '')
$titleLine1 = [string](Get-Prop -Object $card -Name 'titleLine1' -Default '')
$titleLine2Lead = [string](Get-Prop -Object $card -Name 'titleLine2Lead' -Default '')
$titleLine2Accent = [string](Get-Prop -Object $card -Name 'titleLine2Accent' -Default '')

if (-not $titleLine1 -and -not $titleLine2Lead -and -not $titleLine2Accent) {
    throw 'the spec needs at least one title line'
}

$sectionsHtml = ''
foreach ($section in @(Get-Prop -Object $card -Name 'sections' -Default @())) {
    $label = [string](Get-Prop -Object $section -Name 'label' -Default '')
    $accentClass = if ((Get-Prop -Object $section -Name 'accent' -Default $false)) { ' mine' } else { '' }

    $rowsHtml = ''
    foreach ($row in @(Get-Prop -Object $section -Name 'rows' -Default @())) {
        $name = [string](Get-Prop -Object $row -Name 'name' -Default '')
        $role = [string](Get-Prop -Object $row -Name 'role' -Default '')
        $tag = [string](Get-Prop -Object $row -Name 'tag' -Default '')
        $tagHtml = if ($tag) { "<span class=`"tag`">$tag</span>" } else { '' }
        $rowsHtml += "<div class=`"row`"><span class=`"name`">$name</span><span class=`"role`">$role</span>$tagHtml</div>"
    }

    $sectionsHtml += "<div class=`"section-label$accentClass`">$label</div>"
    if ($rowsHtml) { $sectionsHtml += "<div class=`"stack`">$rowsHtml</div>" }

    # A section carries its own meta line, rendered directly under its own rows. Putting it at the
    # top level instead would detach it from the stack it describes and float it above the next
    # section's heading - which is exactly what the first version of this script did.
    $sectionMeta = [string](Get-Prop -Object $section -Name 'meta' -Default '')
    if ($sectionMeta) { $sectionsHtml += "<div class=`"meta`">$sectionMeta</div>" }
}

$mine = Get-Prop -Object $card -Name 'mine'
$mineHtml = ''
if ($null -ne $mine) {
    $mineName = [string](Get-Prop -Object $mine -Name 'name' -Default '')
    $mineRole = [string](Get-Prop -Object $mine -Name 'role' -Default '')
    $mineAccent = [string](Get-Prop -Object $mine -Name 'roleAccent' -Default '')
    $accentHtml = if ($mineAccent) { "<em>$mineAccent</em>" } else { '' }
    $mineHtml = @"
  <div class="mine-box">
    <span class="name">$mineName</span>
    <span class="role">$mineRole$accentHtml</span>
  </div>
"@
}

$quote = Get-Prop -Object $card -Name 'quote'
$quoteHtml = ''
if ($null -ne $quote) {
    $quoteText = [string](Get-Prop -Object $quote -Name 'text' -Default '')
    $quoteSource = [string](Get-Prop -Object $quote -Name 'source' -Default '')
    $sourceHtml = if ($quoteSource) { "<div class=`"src`">$quoteSource</div>" } else { '' }
    $quoteHtml = @"
  <div class="quote">
    <span class="mark">&ldquo;</span>$quoteText<span class="mark">&rdquo;</span>
    $sourceHtml
  </div>
"@
}

$punch = [string](Get-Prop -Object $card -Name 'punch' -Default '')
$punchAccent = [string](Get-Prop -Object $card -Name 'punchAccent' -Default '')
$repo = [string](Get-Prop -Object $card -Name 'repo' -Default '')
$punchHtml = if ($punchAccent) { "$punch<span class=`"accent`">$punchAccent</span>" } else { $punch }
$repoHtml = if ($repo) { "<div class=`"repo`">$repo</div>" } else { '' }

# ---------------------------------------------------------------- render

$html = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg-0: #070b14; --bg-1: #0d1524; --line: #1e2b40;
    --ink: #eaf1fb; --ink-dim: #8ea2be; --ink-faint: #5b6f8c;
    --green: #34d399; --amber: #fbbf24;
    --sans: "Segoe UI", -apple-system, system-ui, sans-serif;
    --mono: "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", monospace;
  }
  html, body { width: 1200px; height: 1200px; }
  body {
    background:
      radial-gradient(900px 700px at 12% -8%, #16243d 0%, transparent 60%),
      radial-gradient(700px 600px at 100% 110%, #12283a 0%, transparent 62%),
      linear-gradient(160deg, var(--bg-1) 0%, var(--bg-0) 70%);
    color: var(--ink); font-family: var(--sans);
    padding: 62px 80px; display: flex; flex-direction: column;
    -webkit-font-smoothing: antialiased;
  }
  /* Nothing may shrink. .stack clips its own overflow for the rounded corners, so a flex shrink
     silently swallows the last row instead of overflowing where it can be seen. */
  body > * { flex: none; }
  .kicker {
    font-family: var(--mono); font-size: 19px; letter-spacing: 3.4px; text-transform: uppercase;
    color: var(--green); display: flex; align-items: center; gap: 14px;
  }
  .kicker::after { content: ""; flex: 1; height: 1px;
    background: linear-gradient(90deg, rgba(52,211,153,.55), transparent); }
  h1 { margin-top: 26px; font-size: 72px; line-height: 1.06; letter-spacing: -2.2px; font-weight: 700; }
  h1 .lead { color: var(--ink-faint); }
  h1 .pop { color: var(--amber); }
  .section-label { margin-top: 38px; font-family: var(--mono); font-size: 20px;
    letter-spacing: 1.6px; color: var(--ink-dim); }
  .section-label.mine { color: var(--amber); }
  .stack { margin-top: 18px; border-radius: 16px; overflow: hidden; border: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: 26px; padding: 19px 28px;
    background: rgba(255,255,255,.022); border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .name { font-family: var(--mono); font-size: 31px; font-weight: 600; width: 132px; flex: none; }
  .role { font-size: 25px; color: #c3d3e8; flex: 1; }
  .tag { font-family: var(--mono); font-size: 17px; color: var(--ink-faint);
    border: 1px solid var(--line); border-radius: 999px; padding: 5px 15px; white-space: nowrap; }
  .meta { margin-top: 16px; font-size: 22px; color: var(--ink-dim); }
  .meta b { color: #c3d3e8; font-weight: 600; }
  .mine-box { margin-top: 18px; border: 1px solid rgba(251,191,36,.42);
    background: linear-gradient(120deg, rgba(251,191,36,.10), rgba(251,191,36,.02));
    border-radius: 16px; padding: 24px 28px; display: flex; align-items: center; gap: 26px; }
  .mine-box .name { color: var(--amber); }
  .mine-box .role { font-size: 24px; color: #e8dcc0; }
  .mine-box .role em { font-style: normal; color: var(--amber); font-weight: 600; }
  .quote { margin-top: 34px; padding-left: 26px; border-left: 3px solid rgba(251,191,36,.45);
    font-size: 26px; line-height: 1.4; color: #cfdcee; font-style: italic; }
  .quote .mark { color: var(--amber); font-style: normal; }
  .quote .src { margin-top: 12px; font-family: var(--mono); font-size: 18px;
    font-style: normal; letter-spacing: .3px; color: var(--ink-faint); }
  .foot { margin-top: auto; padding-top: 40px; display: flex; align-items: flex-end;
    justify-content: space-between; gap: 30px; }
  .punch { font-size: 52px; font-weight: 700; letter-spacing: -1.4px; }
  .punch .accent { color: var(--amber); }
  .repo { font-family: var(--mono); font-size: 19px; color: var(--ink-faint);
    text-align: right; line-height: 1.7; }
</style>
</head>
<body>

  <div class="kicker">$kicker</div>

  <h1>
    $titleLine1<br>
    <span class="lead">$titleLine2Lead</span> <span class="pop">$titleLine2Accent</span>
  </h1>

$sectionsHtml
$mineHtml
$quoteHtml
  <div class="foot">
    <div class="punch">$punchHtml</div>
    $repoHtml
  </div>

</body>
</html>
"@

$htmlPath = [System.IO.Path]::ChangeExtension($outPath, '.html')
Set-Content -LiteralPath $htmlPath -Value $html -Encoding utf8

Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue

# Chrome is a GUI process: `& chrome.exe` returns as soon as it has been *launched*, not when it
# has finished. Checking for the PNG on the next line is a race that is lost most of the time, and
# won occasionally, which is worse — it looks like it works. Start-Process -Wait is the fix.
#
# A throwaway profile matters too: if Chrome is already running, an invocation without its own
# --user-data-dir is handed to the running instance, which ignores --headless and writes nothing.
$profileDir = Join-Path ([System.IO.Path]::GetTempPath()) ('cob-card-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

try {
    $arguments = @(
        '--headless=new'
        '--disable-gpu'
        '--no-sandbox'
        '--no-first-run'
        '--no-default-browser-check'
        '--disable-extensions'
        '--hide-scrollbars'
        "--user-data-dir=`"$profileDir`""
        '--force-device-scale-factor=2'
        '--window-size=1200,1200'
        "--screenshot=`"$outPath`""
        "file:///$($htmlPath -replace '\\','/')"
    )

    $process = Start-Process -FilePath $chrome -ArgumentList $arguments -PassThru -Wait -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "the browser exited with code $($process.ExitCode); check $htmlPath"
    }
} finally {
    Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $outPath)) {
    throw "the browser produced no image; the rendered HTML is at $htmlPath"
}

$size = (Get-Item -LiteralPath $outPath).Length
Write-Output $outPath
Write-Output ("{0:N0} bytes" -f $size)
