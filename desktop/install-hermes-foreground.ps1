param(
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'paperclip-arabic-desktop\agent-support\hermes-foreground')
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'agent-support'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET compiler is unavailable' }
$python = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'hermes\hermes-agent\venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Hermes Python runtime is unavailable' }
$hermesSource = Split-Path (Split-Path (Split-Path $python))
$hashes = @{}
foreach ($relative in @('hermes_cli/oneshot.py', 'run_agent.py', 'tools/approval.py', 'tools/environments/local.py', 'tools/environments/local_env_policy.py')) {
    $hashes[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $hermesSource $relative)).Hash.ToLowerInvariant()
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'hermes-foreground.py') -Destination $Destination -Force
@{ hashes = $hashes } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'hermes-runtime.json') -Encoding UTF8
$output = Join-Path $Destination 'HermesForeground.exe'
& $compiler /nologo /target:exe /platform:x64 "/out:$output" (Join-Path $source 'HermesForeground.cs')
if ($LASTEXITCODE -ne 0) { throw 'Hermes foreground launcher compilation failed' }
Write-Output $output
