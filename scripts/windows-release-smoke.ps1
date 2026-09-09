param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath
)

$ErrorActionPreference = 'Stop'
$port = 47831
$app = Join-Path $env:LOCALAPPDATA 'Runlit\runlit-desktop.exe'
$installRoot = Split-Path $app -Parent
$dataRoot = Join-Path $env:LOCALAPPDATA 'com.runlit.desktop'
$uninstaller = Join-Path $installRoot 'uninstall.exe'

function Test-RunlitPort {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $pending = $client.ConnectAsync('127.0.0.1', $port)
    if (-not $pending.Wait(300)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-RunlitHealth {
  for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
      if ($health.service -eq 'runlit-daemon') { return }
    } catch {}
  }
  throw 'Installed RunLit daemon did not become healthy.'
}

function Wait-PortReleased {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if (-not (Test-RunlitPort)) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "RunLit daemon did not release port $port within 10 seconds."
}

$existingProcesses = @(Get-Process -Name 'runlit-desktop' -ErrorAction SilentlyContinue)
if ($existingProcesses.Count -gt 0) { throw 'Clean-user preflight failed: RunLit is already running.' }
if (Test-RunlitPort) { throw "Clean-user preflight failed: port $port is already in use." }
if (Test-Path -LiteralPath $installRoot) { throw "Clean-user preflight failed: install directory exists: $installRoot" }
if (Test-Path -LiteralPath $dataRoot) { throw "Clean-user preflight failed: data directory exists: $dataRoot" }

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$installer = Start-Process $resolvedSetup -ArgumentList '/S' -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Installer exited with $($installer.ExitCode)." }
if (-not (Test-Path -LiteralPath $app)) { throw "Installed app is missing: $app" }

# An invalid explicit path deterministically represents a machine without Codex.
# RunLit must remain healthy and expose the adapter as unavailable, not crash.
$env:RUNLIT_CODEX_PATH = Join-Path $env:RUNNER_TEMP 'codex-not-installed\codex.exe'
$desktop = Start-Process $app -PassThru
try {
  Wait-RunlitHealth
  $tokenPath = Join-Path $dataRoot 'auth-token'
  for ($attempt = 0; $attempt -lt 40 -and -not (Test-Path -LiteralPath $tokenPath); $attempt += 1) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $tokenPath)) { throw 'RunLit auth token was not created.' }
  $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
  $adapters = Invoke-RestMethod -Uri "http://127.0.0.1:$port/adapters" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 3
  if ($adapters.codex.state -ne 'unavailable') {
    throw "Expected Codex adapter to be unavailable without Codex; actual state: $($adapters.codex.state)"
  }

  Invoke-RestMethod -Uri "http://127.0.0.1:$port/shutdown" -Method Post -Headers @{ Origin = 'http://tauri.localhost' } -TimeoutSec 3 | Out-Null
  Wait-PortReleased
} finally {
  Remove-Item Env:RUNLIT_CODEX_PATH -ErrorAction SilentlyContinue
  if (-not $desktop.HasExited) { Stop-Process -Id $desktop.Id -Force }
}

if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller is missing: $uninstaller" }
$remove = Start-Process $uninstaller -ArgumentList '/S' -PassThru -Wait
if ($remove.ExitCode -ne 0) { throw "Uninstaller exited with $($remove.ExitCode)." }
if (Test-Path -LiteralPath $app) { throw 'Installed executable remains after uninstall.' }
if (Test-RunlitPort) { throw "Port $port was rebound after uninstall." }

Write-Host 'Windows release preflight passed: clean profile, missing Codex fallback, daemon port release, install, and uninstall.'
