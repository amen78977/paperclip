# Schedule an inexpensive daily source check even when the EXE is closed.
# Updates are published by the separate GitHub Actions workflow only after
# Arabic checks pass; this task never runs installation code.
[CmdletBinding()]
param([string] $At = '08:00')
$ErrorActionPreference = 'Stop'
if ($At -notmatch '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$') {
  throw 'Use a local 24-hour time HH:mm, for example 08:00.'
}
$script = (Resolve-Path (Join-Path $PSScriptRoot 'check-official-updates.ps1')).Path
$action = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
& schtasks.exe /Create /SC DAILY /ST $At /TN 'PaperclipArabic-UpstreamWatch' /TR $action /F
if ($LASTEXITCODE -ne 0) { throw 'Windows Task Scheduler could not create the check task.' }
Write-Output "Enabled a daily Paperclip upstream source check at $At (computer local time)."
Write-Output 'Only checks availability; publishing requires a GitHub fork and verified CI release.'
