@echo off
rem Shows the AKI MCP tray icon. The console window closes immediately; the tray keeps running.
rem
rem   AKI-Tray.bat              normal launch (hidden)
rem   AKI-Tray.bat autostart    launch and bring the MCP stack up
rem   AKI-Tray.bat debug        visible console that stays open, so startup errors are readable
rem
rem Use "debug" first whenever the normal launch seems to do nothing.
setlocal

if /i "%~1"=="debug" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -NoExit -File "%~dp0scripts\tray.ps1"
  endlocal
  exit /b
)

set "EXTRA="
if /i "%~1"=="autostart" set "EXTRA= -AutoStart"
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "%~dp0scripts\tray.ps1"%EXTRA%
endlocal
