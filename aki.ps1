#Requires -Version 5.1
<#
  AKI MCP switch — starts and stops the whole stack as one unit.

  The tunnel is NOT started here: scripts/start.js owns cloudflared, so `npm start` is the
  single entry point and there is never a second tunnel racing the first.

  All configuration lives in .env, which start.js loads by itself. This script only reads the
  ports back out of it for status reporting, so there is exactly one place to edit.

  Usage:
    .\aki.ps1            # toggle
    .\aki.ps1 start|stop|status
#>
param(
  [ValidateSet('start', 'stop', 'status', 'toggle')]
  [string]$Action = 'toggle'
)

$ErrorActionPreference = 'Stop'

$RepoRoot      = $PSScriptRoot
$EnvFile       = Join-Path $RepoRoot '.env'
$UserDir       = Join-Path $env:USERPROFILE '.aki\mcpsv'
$StateFile     = Join-Path $UserDir 'run-pids.json'
# start.js writes this on every boot: the panel token is regenerated each time, so the bare
# host:port only ever gets a 403.
$PanelUrlFile  = Join-Path $UserDir 'panel-url.txt'
$LogDir        = Join-Path $UserDir 'logs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Parse .env by hand rather than dot-sourcing it: a config file must never execute anything here.
function Get-EnvSetting([string]$Key, [string]$Fallback = '') {
  if (-not (Test-Path $EnvFile)) { return $Fallback }
  $match = Select-String -Path $EnvFile -Pattern ("^\s*{0}\s*=\s*`"?([^`"#]*)`"?" -f $Key) |
    Select-Object -Last 1
  if ($match) { return $match.Matches[0].Groups[1].Value.Trim() }
  return $Fallback
}

$GatekeeperPort = Get-EnvSetting 'GATEKEEPER_PORT' '9999'
$Origin         = (Get-EnvSetting 'PUBLIC_ORIGIN').TrimEnd('/')

function Get-PanelUrl {
  if (Test-Path $PanelUrlFile) {
    $url = (Get-Content $PanelUrlFile -First 1).Trim()
    if ($url) { return $url }
  }
  return ''
}

function Read-State {
  if (-not (Test-Path $StateFile)) { return $null }
  try { Get-Content $StateFile -Raw | ConvertFrom-Json } catch { $null }
}

function Test-Alive([int]$TargetPid) {
  if (-not $TargetPid) { return $false }
  return $null -ne (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)
}

function Get-Status {
  $s = Read-State
  [pscustomobject]@{
    NodePid   = $s.node
    NodeAlive = Test-Alive $s.node
    Listening = [bool](Get-NetTCPConnection -LocalPort ([int]$GatekeeperPort) -State Listen -ErrorAction SilentlyContinue)
    PanelUrl  = if (Get-PanelUrl) { Get-PanelUrl } else { '<not running - no token yet>' }
    Origin    = if ($Origin) { $Origin } else { '<none>' }
  }
}

function Start-Stack {
  if ((Get-Status).NodeAlive) {
    Write-Host 'already running' -ForegroundColor Yellow
    return
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  # No env vars are pushed in here: start.js loads .env relative to its working directory.
  $p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput (Join-Path $LogDir "mcp-$stamp.log") `
    -RedirectStandardError  (Join-Path $LogDir "mcp-$stamp.err.log") `
    -WindowStyle Hidden -PassThru

  @{ node = $p.Id; started = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content $StateFile -Encoding UTF8

  Write-Host "  mcp server  pid $($p.Id)" -ForegroundColor Green
  Write-Host "ON   $Origin/mcp" -ForegroundColor Green
  Write-Host "logs $LogDir" -ForegroundColor DarkGray
}

function Stop-Stack {
  $s = Read-State

  # taskkill /T is still required: npm.cmd is the parent of node, and node in turn owns
  # cloudflared and the Postman daemon. Killing only the parent leaves all of them alive.
  if (Test-Alive $s.node) {
    & taskkill.exe /PID $s.node /T /F 2>&1 | Out-Null
  }

  # No blanket `Stop-Process cloudflared` here on purpose: it would also kill unrelated
  # tunnels running on this machine. The /T above already covers the one we started.

  Remove-Item $StateFile -ErrorAction SilentlyContinue
  Write-Host 'OFF' -ForegroundColor Red
}

switch ($Action) {
  'start'  { Start-Stack }
  'stop'   { Stop-Stack }
  'status' { Get-Status | Format-List }
  'toggle' {
    if ((Get-Status).NodeAlive) { Stop-Stack } else { Start-Stack }
  }
}
