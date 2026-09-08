param(
  [string]$RepositoryUrl = '',
  [string]$TargetPath = (Join-Path $env:USERPROFILE 'VolputasData'),
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'Volputas\local-config.json')
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

# The company's own private data repository - there is no default. Companies must not
# end up silently cloning the public LUDIARS/VolputasData template into Local
# Settings; requiring this parameter makes that a usage error instead of a possibility.
if (-not $RepositoryUrl) {
  throw @'
Usage: setup-volputas-data.ps1 -RepositoryUrl <repository-url> [-TargetPath <path>] [-ConfigPath <path>]

<repository-url> is your own private GitHub data repository (for example a copy
made from the LUDIARS/VolputasData template). There is no default: pass it
explicitly.
'@
}

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  throw 'Git CLI was not found in PATH. Install Git and restart the terminal.'
}
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  throw 'GitHub CLI ("gh") was not found in PATH. Install it and run "gh auth login", then retry.'
}

if (Test-Path -LiteralPath (Join-Path $TargetPath '.git')) {
  & $git.Source -C $TargetPath remote get-url origin | Out-Null
} elseif (Test-Path -LiteralPath $TargetPath) {
  throw "Target exists but is not a Git repository: $TargetPath"
} else {
  & $git.Source clone -- $RepositoryUrl $TargetPath
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}

$repositoryRoot = (& $git.Source -C $TargetPath rev-parse --show-toplevel).Trim()
$originUrl = (& $git.Source -C $repositoryRoot remote get-url origin).Trim()

# The data repository holds real player evidence, so it must be private. This is
# checked here (setup time) and independently by the desktop app itself when Local
# Settings are saved (src/local/dataRepositoryVisibility.js) - the app never trusts
# that this script was run, or run correctly.
#
# owner/repo is interpolated into the "repos/<owner>/<repo>" API path below, so the
# patterns accept only GitHub's own name charset, and relative segments that could
# re-point that path are rejected.
$ownerRepo = $null
foreach ($pattern in @(
  '^git@github\.com:(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$',
  '^ssh://git@github\.com/(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$',
  '^https://github\.com/(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$'
)) {
  if ($originUrl -match $pattern) {
    if ($Matches.owner -in '.', '..' -or $Matches.repo -in '.', '..') { break }
    $ownerRepo = "$($Matches.owner)/$($Matches.repo)"
    break
  }
}
if (-not $ownerRepo) {
  throw "Origin ""$originUrl"" is not a github.com owner/repo URL; cannot verify visibility."
}

# A single scalar line ("true|private") rather than an embedded JSON object, matching
# setup-volputas-data.sh: an object result is not guaranteed to arrive on one line, and
# Windows PowerShell 5.1 pipes multi-line native output into ConvertFrom-Json as a
# string array, which fails to parse. A scalar line is unambiguous to compare directly.
$visibilityLines = @(
  & $gh.Source api "repos/$ownerRepo" --jq '(.private | tostring) + "|" + .visibility'
)
$ghExitCode = $LASTEXITCODE
if ($ghExitCode -ne 0) {
  throw "Unable to look up ""$ownerRepo"" via the GitHub CLI. Confirm ""gh auth status"" and that you have access."
}
$visibilitySummary = ($visibilityLines -join '')
# An empty result means `gh` produced no visibility line despite exiting 0 (for example
# a jq filter that matched nothing). Treat it as unverified rather than comparing an
# empty string, so the check can never pass by producing no answer at all.
if (-not $visibilitySummary.Trim()) {
  throw "Unable to determine the visibility of ""$ownerRepo"" via the GitHub CLI. Confirm ""gh auth status"" and that you have access."
}
if ($visibilitySummary.Trim() -ne 'true|private') {
  throw "Repository ""$ownerRepo"" is not private (private|visibility: $($visibilitySummary.Trim())). Use a private repository for player data."
}

$authorName = (& $git.Source -C $repositoryRoot config --get user.name).Trim()
$authorEmail = (& $git.Source -C $repositoryRoot config --get user.email).Trim()
if (-not $authorName -or -not $authorEmail) {
  throw 'Configure git user.name and user.email before running this script.'
}
$invalidAuthorName = $authorName -in '.', '..' -or $authorName -match '[<>:"/\\|?*\x00-\x1F]' -or $authorName -match '[. ]$' -or $authorName -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$'
if ($invalidAuthorName) {
  throw 'git user.name cannot be used as a portable answer folder name.'
}

$config = @{
  schemaVersion = 2
  dataRepositoryPath = $repositoryRoot
  name = $authorName
}
$configDirectory = Split-Path -Parent $ConfigPath
[System.IO.Directory]::CreateDirectory($configDirectory) | Out-Null
[System.IO.File]::WriteAllText(
  $ConfigPath,
  "$(ConvertTo-Json $config -Depth 3)`n",
  $Utf8NoBom
)

Write-Output "Git: $(& $git.Source --version)"
Write-Output "Repository: $repositoryRoot (private)"
Write-Output "Name: $authorName"
Write-Output "Config: $ConfigPath"
