param(
  [string]$RepositoryUrl = 'https://github.com/LUDIARS/VolputasData.git',
  [string]$TargetPath = (Join-Path $env:USERPROFILE 'VolputasData'),
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'Volputas\local-config.json')
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  throw 'Git CLI was not found in PATH. Install Git and restart the terminal.'
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
Write-Output "Repository: $repositoryRoot"
Write-Output "Name: $authorName"
Write-Output "Config: $ConfigPath"
