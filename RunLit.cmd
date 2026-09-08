@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-runlit.ps1"
if errorlevel 1 (
  echo.
  echo RunLit failed to start. See the message above.
  pause
)
endlocal
