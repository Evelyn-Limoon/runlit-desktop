[CmdletBinding()]
param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$daemonEntry = Join-Path $projectRoot 'apps\daemon\dist\index.js'
$releaseDesktop = Join-Path $projectRoot 'apps\desktop\src-tauri\target\release\runlit-desktop.exe'
$debugDesktop = Join-Path $projectRoot 'apps\desktop\src-tauri\target\debug\runlit-desktop.exe'

function Test-RunLitDaemon {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:47831/health' -TimeoutSec 2
        return $health.service -eq 'runlit-daemon'
    }
    catch {
        return $false
    }
}

function Resolve-Cargo {
    $command = Get-Command cargo -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $userCargo = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo\bin\cargo.exe'
    if (Test-Path -LiteralPath $userCargo) { return $userCargo }
    return $null
}

function Resolve-CodexExecutable {
    if ($env:RUNLIT_CODEX_PATH) {
        $configured = $env:RUNLIT_CODEX_PATH.Trim().Trim('"')
        if (Test-Path -LiteralPath $configured -PathType Leaf) {
            return [pscustomobject]@{ Path = [System.IO.Path]::GetFullPath($configured); Source = 'environment' }
        }
        throw "RUNLIT_CODEX_PATH does not point to a file: $configured"
    }

    $command = Get-Command codex.exe -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command codex.cmd -ErrorAction SilentlyContinue }
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        return [pscustomobject]@{ Path = [System.IO.Path]::GetFullPath($command.Source); Source = 'PATH' }
    }

    if ($env:LOCALAPPDATA) {
        $codexBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $codexBin -PathType Container) {
            $desktopCandidate = Get-ChildItem -LiteralPath $codexBin -Filter 'codex.exe' -File -Recurse -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -First 1
            if ($desktopCandidate) {
                return [pscustomobject]@{ Path = $desktopCandidate.FullName; Source = 'Codex Desktop' }
            }
        }
    }

    return $null
}

Set-Location -LiteralPath $projectRoot

$codexExecutable = Resolve-CodexExecutable
if ($codexExecutable) {
    # Start-Process inherits this launcher's environment on Windows PowerShell 5.1.
    $env:RUNLIT_CODEX_PATH = $codexExecutable.Path
}

$desktopExecutable = if (Test-Path -LiteralPath $releaseDesktop) {
    $releaseDesktop
}
elseif (Test-Path -LiteralPath $debugDesktop) {
    $debugDesktop
}
else {
    $null
}

if ((-not (Test-Path -LiteralPath $daemonEntry) -or -not $desktopExecutable) -and -not $NoBuild) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw 'Node.js 24+ and npm are required for the first source build.' }

    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        & $npm.Source ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'The RunLit TypeScript build failed.' }

    $cargo = Resolve-Cargo
    if (-not $cargo) { throw 'The Rust MSVC toolchain is required for the first desktop build.' }
    & $npm.Source run tauri -- build
    if ($LASTEXITCODE -ne 0) { throw 'The RunLit desktop bundle build failed.' }
    $desktopExecutable = $releaseDesktop
}

if (-not (Test-Path -LiteralPath $daemonEntry)) {
    throw "Daemon output is missing: $daemonEntry. Remove -NoBuild or run npm run build."
}
if (-not $desktopExecutable -or -not (Test-Path -LiteralPath $desktopExecutable)) {
    throw 'RunLit desktop output is missing. Remove -NoBuild to perform the first build.'
}

if (-not (Test-RunLitDaemon)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js 24+ is required to run the RunLit daemon.' }
    $quotedDaemon = '"' + $daemonEntry + '"'
    Start-Process -FilePath $node.Source -ArgumentList $quotedDaemon -WorkingDirectory $projectRoot -WindowStyle Hidden

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        Start-Sleep -Milliseconds 200
        if (Test-RunLitDaemon) { $ready = $true; break }
    }
    if (-not $ready) { throw 'RunLit daemon did not start on 127.0.0.1:47831.' }
}

$desktopPath = [System.IO.Path]::GetFullPath($desktopExecutable)
$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='runlit-desktop.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $desktopPath }

if (-not $alreadyRunning) {
    Start-Process -FilePath $desktopExecutable -WorkingDirectory $projectRoot
}

if ($codexExecutable) {
    Write-Host "RunLit started. Codex found via $($codexExecutable.Source): $($codexExecutable.Path)"
}
else {
    Write-Warning 'RunLit started without Codex integration. Install Codex or set RUNLIT_CODEX_PATH, then restart RunLit.'
}
Write-Host 'Codex adapter status: http://127.0.0.1:47831/adapters'
