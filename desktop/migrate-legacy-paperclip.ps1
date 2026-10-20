# Migrate a dormant Paperclip instance to the dedicated Arabic Windows app.
# Backups are kept, and the original instance is never modified.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$source = Join-Path $env:USERPROFILE '.paperclip'
$appRoot = Join-Path $env:APPDATA 'paperclip-arabic-desktop'
$target = Join-Path $appRoot 'paperclip-data'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $appRoot "paperclip-data.import-staging-$stamp"
$backup = Join-Path $appRoot "paperclip-data.before-import-$stamp"
$logFile = Join-Path $appRoot "migration-copy-$stamp.log"

if (-not (Test-Path (Join-Path $source 'instances\default\db\PG_VERSION'))) { throw 'No original Paperclip PostgreSQL database was found.' }
if (-not (Test-Path (Join-Path $target 'instances\default\config.json'))) { throw 'The dedicated Arabic app has not been initialized.' }
if ((Get-Content (Join-Path $source 'instances\default\db\PG_VERSION')).Trim() -ne (Get-Content (Join-Path $target 'instances\default\db\PG_VERSION')).Trim()) {
  throw 'Incompatible major PostgreSQL versions. Refusing a physical copy.'
}
if (Test-Path $stage) { throw 'The migration staging directory already exists.' }

# Either instance must be fully shut down to copy physical database files.
$sourceDb = Join-Path $source 'instances\default\db'
$targetDb = Join-Path $target 'instances\default\db'
$runningDb = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'postgres.exe' -and ($_.CommandLine -like "*$sourceDb*" -or $_.CommandLine -like "*$targetDb*")
}
if ($runningDb) { throw 'A Paperclip PostgreSQL process is still running. Stop it safely before importing.' }

New-Item -ItemType Directory -Force -Path $stage | Out-Null
Write-Output 'COPYING_ORIGINAL (original is read-only)'
& robocopy.exe $source $stage /E /XJ /R:2 /W:1 /COPY:DAT /DCOPY:DAT /NFL /NDL /NJH /NJS /NP "/LOG:$logFile" | Out-Null
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) { throw "Copy failed: robocopy exit $copyCode. The current app data remain unchanged. Log: $logFile" }
foreach ($required in @('instances\default\config.json', 'instances\default\.env', 'instances\default\db\PG_VERSION')) {
  if (-not (Test-Path (Join-Path $stage $required))) { throw "Incomplete copy: $required" }
}

# Old JSON contains machine-specific absolute paths for DB, backup, logs,
# storage and the local encryption key. Preserve credentials in the old .env
# and secrets directory; never generate new ones for imported encrypted data.
$cfgPath = Join-Path $stage 'instances\default\config.json'
$cfg = Get-Content -Raw -LiteralPath $cfgPath | ConvertFrom-Json
$instanceRoot = Join-Path $target 'instances\default'
$cfg.database.embeddedPostgresDataDir = Join-Path $instanceRoot 'db'
$cfg.database.backup.dir = Join-Path $instanceRoot 'data\backups'
$cfg.logging.logDir = Join-Path $instanceRoot 'logs'
$cfg.storage.localDisk.baseDir = Join-Path $instanceRoot 'data\storage'
$cfg.secrets.localEncrypted.keyFilePath = Join-Path $instanceRoot 'secrets\master.key'
$cfg.server.host = '127.0.0.1'
$cfg.server.port = 31287
$cfg.server.bind = 'loopback'
$cfg.server.exposure = 'private'
$cfg.server.deploymentMode = 'local_trusted'
$cfg.server.serveUi = $true
$cfg.server.allowedHostnames = @()
$json = ConvertTo-Json -InputObject $cfg -Depth 80
[System.IO.File]::WriteAllText($cfgPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

# A stale PID file in the copied original would prevent embedded PostgreSQL
# starting. Never remove any source file.
$stalePid = Join-Path $stage 'instances\default\db\postmaster.pid'
if (Test-Path $stalePid) { Remove-Item -LiteralPath $stalePid -Force }
$stageCount = (Get-ChildItem $stage -Recurse -File -Force | Measure-Object).Count
if ($stageCount -lt 100) { throw "Unexpectedly few source files ($stageCount); nothing replaced." }

Write-Output 'ARCHIVING_NEW_APP_DATA'
Rename-Item -LiteralPath $target -NewName (Split-Path $backup -Leaf)
try {
  Rename-Item -LiteralPath $stage -NewName (Split-Path $target -Leaf)
} catch {
  if (-not (Test-Path $target) -and (Test-Path $backup)) {
    Rename-Item -LiteralPath $backup -NewName (Split-Path $target -Leaf)
  }
  throw
}
Write-Output "MIGRATION_COPY_OK files=$stageCount"
Write-Output "ORIGINAL_PRESERVED=$source"
Write-Output "PREVIOUS_APP_BACKUP=$backup"
Write-Output "CURRENT_DATA=$target"
Write-Output "COPY_LOG=$logFile"
