# PostgreSQL refuses to start under the GitHub-hosted Windows runneradmin
# account (member of Administrators). Run the EXE runtime smoke under a
# disposable unprivileged local account without exposing any production data.
# Never run this against existing Paperclip user data.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$userName = 'pcsmoke' + [Guid]::NewGuid().ToString('N').Substring(0, 9)
$account = "$env:COMPUTERNAME\$userName"
$logDir = Join-Path $env:PUBLIC "paperclip-smoke-$userName"
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$smokeScript = Join-Path $PSScriptRoot 'smoke-runtime.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$created = $false
try {
  $secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(30)) + 'aA1!'
  $secure = ConvertTo-SecureString $secret -AsPlainText -Force
  $credentials = [System.Management.Automation.PSCredential]::new($account, $secure)
  New-LocalUser -Name $userName -Password $secure -Description 'Temporary non-admin Paperclip CI smoke user' -AccountNeverExpires | Out-Null
  $created = $true
  $groups = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object Name)
  if ($groups -contains $account) { throw 'Smoke test account unexpectedly has administrative privileges.' }
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  & icacls.exe $logDir /grant "${account}:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to grant the smoke user write access to its test log directory.' }
  $stdout = Join-Path $logDir 'stdout.txt'
  $stderr = Join-Path $logDir 'stderr.txt'
  $p = Start-Process -FilePath $node -ArgumentList @("`"$smokeScript`"") `
    -Credential $credentials -LoadUserProfile -WorkingDirectory $projectDir `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait -WindowStyle Hidden
  Get-Content $stdout -ErrorAction SilentlyContinue | Select-Object -Last 18
  if ($p.ExitCode -ne 0) {
    Get-Content $stderr -ErrorAction SilentlyContinue | Select-Object -Last 45
    throw "Non-admin Windows smoke failed with exit code $($p.ExitCode)."
  }
  if (-not (Select-String -Path $stdout -SimpleMatch 'PASS: HTTP health + Arabic UI HTML' -Quiet)) {
    throw 'Smoke process exited without successful HTTP/Arabic UI evidence.'
  }
  Write-Output 'PASS: non-admin Windows Paperclip startup, embedded PostgreSQL, HTTP health and Arabic UI.'
} finally {
  if ($created) { Remove-LocalUser -Name $userName -ErrorAction SilentlyContinue }
  if (Test-Path $logDir) { Remove-Item -LiteralPath $logDir -Recurse -Force -ErrorAction SilentlyContinue }
}
