@echo off
rem Shows the AKI MCP tray icon. The console window closes immediately; the tray keeps running.
rem Pass "autostart" to also bring the MCP stack up.
setlocal
set "EXTRA="
if /i "%~1"=="autostart" set "EXTRA= -AutoStart"
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "%~dp0scripts\tray.ps1"%EXTRA%
endlocal
