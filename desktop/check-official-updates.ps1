# Read-only local safety net for the Arabic edition. The GitHub fork (when
# activated) does the actual merging, testing and publishing. This checker
# NEVER replaces the Windows executable or touches Paperclip databases.
[CmdletBinding()]
param(
  [string] $ProjectRoot
)
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path $PSScriptRoot -Parent }
$repo = (Resolve-Path -LiteralPath $ProjectRoot).Path
$dataDir = Join-Path $env:APPDATA 'paperclip-arabic-desktop\updates'
$stateFile = Join-Path $dataDir 'official-status.json'
$url = 'https://github.com/paperclipai/paperclip.git'

$remoteResult = @(& git -C $repo ls-remote --heads $url master 2>&1)
if ($LASTEXITCODE -ne 0) {
  throw "GitHub update check failed. Existing status remains unchanged. $($remoteResult -join ' ')"
}
$match = [regex]::Match(($remoteResult -join "`n"), '(?m)^([0-9a-f]{40})\s+refs/heads/master$')
if (-not $match.Success) { throw 'Unexpected upstream ref response. Existing status remains unchanged.' }
$remoteSha = $match.Groups[1].Value

$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read local Git revision.' }
# If we have the upstream commit locally, Git can tell whether our Arabic
# branch already contains it. Otherwise a newer commit exists on GitHub.
$hasRemote = $false
$priorPreference = $ErrorActionPreference
try {
  # PowerShell 5 treats a nonzero native stderr as an exception under Stop.
  $ErrorActionPreference = 'Continue'
  & git -C $repo cat-file -e "$remoteSha^{commit}" 2>$null
  if ($LASTEXITCODE -eq 0) { $hasRemote = $true }
} finally { $ErrorActionPreference = $priorPreference }
$containsRemote = $false
if ($hasRemote) {
  & git -C $repo merge-base --is-ancestor $remoteSha $head
  $containsRemote = ($LASTEXITCODE -eq 0)
}
$newUpdates = (-not $containsRemote)

New-Item -Path $dataDir -ItemType Directory -Force | Out-Null
$status = [ordered]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  officialRepository = 'paperclipai/paperclip'
  officialCommit = $remoteSha
  localArabicCommit = $head
  upstreamChangesAvailable = $newUpdates
  note = if ($newUpdates) { 'Official source has updates. Arabic integration still requires passing CI.' } else { 'This Arabic checkout includes the official upstream commit.' }
}
$temp = Join-Path $dataDir ([guid]::NewGuid().ToString('N') + '.tmp')
try {
  [System.IO.File]::WriteAllText($temp, (ConvertTo-Json $status -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $stateFile -Force
} finally {
  if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force }
}
Write-Output "UPSTREAM_AVAILABLE=$newUpdates OFFICIAL=$remoteSha LOCAL=$head"
Write-Output "STATUS_FILE=$stateFile"
