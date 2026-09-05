@echo off
rem Same tray icon, but in a visible console so startup errors are readable.
rem Use this first when the hidden launcher seems to do nothing.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -NoExit -File "%~dp0scripts\tray.ps1"
