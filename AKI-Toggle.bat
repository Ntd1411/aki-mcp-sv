@echo off
rem Double-click this to switch the MCP server (and its Cloudflare tunnel) on or off.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0aki.ps1" toggle
echo.
timeout /t 4 >nul
