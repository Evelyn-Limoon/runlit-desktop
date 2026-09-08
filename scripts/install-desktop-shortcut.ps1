[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-runlit.ps1'
$icon = Join-Path $projectRoot 'apps\desktop\src-tauri\icons\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'RunLit.lnk'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher not found: $launcher" }
if (-not (Test-Path -LiteralPath $icon)) { throw "RunLit icon not found: $icon" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Start the RunLit AI task observer'
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'Desktop shortcut creation failed.' }
Write-Output $shortcutPath
