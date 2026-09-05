' Optional zero-flash launcher for the AKI MCP tray icon.
' Prefer AKI-Tray.bat: recent Windows builds can have VBScript disabled, in which case
' double-clicking this file silently does nothing.
Option Explicit

Dim fso, shell, repoRoot, scriptPath, extraArgs, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repoRoot = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = repoRoot & "\scripts\tray.ps1"

If Not fso.FileExists(scriptPath) Then
  MsgBox "Missing file: " & scriptPath, 16, "AKI MCP tray"
  WScript.Quit 1
End If

extraArgs = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "autostart" Then extraArgs = " -AutoStart"
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File """ & scriptPath & """" & extraArgs

' 0 = hidden window, False = do not wait for the tray to exit.
shell.Run command, 0, False
