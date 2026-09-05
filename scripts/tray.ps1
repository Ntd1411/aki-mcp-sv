#Requires -Version 5.1
<#
  AKI MCP tray icon - a Unikey-style switch in the Windows notification area.

  Every action delegates to aki.ps1, so the tray never becomes a second implementation
  of start/stop.

  Usage:
    AKI-Tray.bat              hidden launch (normal use)
    AKI-Tray-Debug.bat        visible console, shows errors
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tray.ps1 -AutoStart
#>
param([switch]$AutoStart)

$ErrorActionPreference = 'Stop'

$RepoRoot     = Split-Path $PSScriptRoot -Parent
$SwitchScript = Join-Path $RepoRoot 'aki.ps1'
$EnvFile      = Join-Path $RepoRoot '.env'
# .NET cannot rasterise SVG, so Windows keeps the raster set; public/obs-tray.svg is the
# Linux/Plasma source of the same mark.
$IconPath     = Join-Path $RepoRoot 'public\favicon\favicon.ico'
$LogoPath     = Join-Path $RepoRoot 'public\favicon\icon-192.png'
$UserDir      = Join-Path $env:USERPROFILE '.aki\mcpsv'
$StateFile    = Join-Path $UserDir 'run-pids.json'
# start.js writes this on every boot: the panel token is regenerated each time.
$PanelUrlFile = Join-Path $UserDir 'panel-url.txt'
$LogDir       = Join-Path $UserDir 'logs'
$TrayLog      = Join-Path $LogDir 'tray.log'
$StartupMarker = Join-Path $UserDir 'tray-installed'
$StartupLink  = Join-Path ([Environment]::GetFolderPath('Startup')) 'AKI MCP.lnk'

# A hidden launch shows no console, so any startup failure has to surface by itself.
function Write-TrayLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Add-Content -Path $TrayLog -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  } catch { }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  # WaitOne(0) is the reliable single-instance check; the Mutex constructor's out-parameter
  # does not bind well through New-Object.
  $mutex = New-Object System.Threading.Mutex($false, 'Local\AkiMcpTray')
  if (-not $mutex.WaitOne(0)) {
    Write-TrayLog 'Another tray instance is already running.'
    return
  }

  # .env is the single source of truth start.js itself loads, so read it rather than aki.ps1.
  # Parsed by hand instead of dot-sourced: a config file must never execute anything here.
  function Get-EnvSetting([string]$Key, [string]$Fallback = '') {
    if (-not (Test-Path $EnvFile)) { return $Fallback }
    $match = Select-String -Path $EnvFile -Pattern ("^\s*{0}\s*=\s*`"?([^`"#]*)`"?" -f $Key) |
      Select-Object -Last 1
    if ($match) { return $match.Matches[0].Groups[1].Value.Trim() }
    return $Fallback
  }

  $Origin = (Get-EnvSetting 'PUBLIC_ORIGIN').TrimEnd('/')
  if ($Origin) { $McpUrl = $Origin + '/mcp' } else { $McpUrl = '' }

  function Get-PanelUrl {
    if (-not (Test-Path $PanelUrlFile)) { return '' }
    try { return (Get-Content $PanelUrlFile -First 1).Trim() } catch { return '' }
  }

  function Test-StackRunning {
    if (-not (Test-Path $StateFile)) { return $false }
    try { $state = Get-Content $StateFile -Raw | ConvertFrom-Json } catch { return $false }
    if (-not $state.node) { return $false }
    return $null -ne (Get-Process -Id ([int]$state.node) -ErrorAction SilentlyContinue)
  }

  function Invoke-Switch([string]$Action) {
    Start-Process -FilePath 'powershell.exe' `
      -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SwitchScript, $Action `
      -WindowStyle Hidden | Out-Null
  }

  # Showing the icon at login and starting the server at login are two separate decisions:
  # one Startup shortcut covers both, encoding the second one by carrying -AutoStart or not.
  function Test-StartupEnabled { Test-Path $StartupLink }

  function Test-AutoStartEnabled {
    if (-not (Test-Path $StartupLink)) { return $false }
    try {
      $shell = New-Object -ComObject WScript.Shell
      return ($shell.CreateShortcut($StartupLink).Arguments -match '-AutoStart')
    } catch {
      return $false
    }
  }

  function Set-StartupLink([bool]$Enabled, [bool]$WithAutoStart) {
    if (-not $Enabled) {
      Remove-Item $StartupLink -ErrorAction SilentlyContinue
      return
    }
    # Target powershell.exe directly: recent Windows builds can have VBScript disabled entirely.
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($StartupLink)
    $link.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $PSCommandPath
    if ($WithAutoStart) { $arguments += ' -AutoStart' }
    $link.Arguments = $arguments
    $link.WorkingDirectory = $RepoRoot
    $link.WindowStyle = 7
    if (Test-Path $IconPath) { $link.IconLocation = $IconPath }
    $link.Description = 'AKI MCP server tray icon'
    $link.Save()
  }

  # .NET Framework's Icon class chokes on .ico files whose frames are PNG-compressed, so the PNG
  # is tried first and every loader is guarded; the tray must never die over its own artwork.
  function New-BaseImage {
    foreach ($candidate in @($LogoPath, $IconPath)) {
      if (-not (Test-Path $candidate)) { continue }
      try {
        if ([System.IO.Path]::GetExtension($candidate) -eq '.ico') {
          $ico = New-Object System.Drawing.Icon($candidate)
          $bitmap = $ico.ToBitmap()
          $ico.Dispose()
          return $bitmap
        }
        return New-Object System.Drawing.Bitmap($candidate)
      } catch {
        Write-TrayLog ('Could not load icon source {0}: {1}' -f $candidate, $_.Exception.Message)
      }
    }
    return $null
  }

  # The project icon with a status dot burned into the corner: readable at 16px, no second icon file to keep in sync.
  function New-StatusIcon([bool]$Running) {
    $bitmap = New-Object System.Drawing.Bitmap 32, 32
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $box = New-Object System.Drawing.Rectangle 0, 0, 32, 32
    if ($script:baseImage) {
      $graphics.DrawImage($script:baseImage, $box)
    } else {
      # Last-resort mark, so a missing or unreadable logo still leaves a usable tray icon.
      $backdrop = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 44, 52))
      $graphics.FillEllipse($backdrop, $box)
      $font = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
      $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
      $format = New-Object System.Drawing.StringFormat
      $format.Alignment = [System.Drawing.StringAlignment]::Center
      $format.LineAlignment = [System.Drawing.StringAlignment]::Center
      $textBox = New-Object System.Drawing.RectangleF 0, 0, 32, 32
      $graphics.DrawString('A', $font, $textBrush, $textBox, $format)
      $format.Dispose()
      $textBrush.Dispose()
      $font.Dispose()
      $backdrop.Dispose()
    }

    if ($Running) {
      $dotColor = [System.Drawing.Color]::FromArgb(46, 204, 113)
    } else {
      $dotColor = [System.Drawing.Color]::FromArgb(231, 76, 60)
    }
    $brush = New-Object System.Drawing.SolidBrush $dotColor
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 2
    $graphics.FillEllipse($brush, 17, 17, 14, 14)
    $graphics.DrawEllipse($pen, 17, 17, 14, 14)

    # Both icons are built once and kept for the process lifetime, so the GDI handles stay bounded.
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())

    $pen.Dispose()
    $brush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    return $icon
  }

  $script:baseImage = New-BaseImage
  $iconRunning = New-StatusIcon $true
  $iconStopped = New-StatusIcon $false

  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = $iconStopped
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $notify.ContextMenuStrip = $menu

  function Add-MenuItem([string]$Text, $OnClick) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem $Text
    if ($OnClick) { $item.Add_Click($OnClick) } else { $item.Enabled = $false }
    [void]$menu.Items.Add($item)
    return $item
  }

  function Add-Separator { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) }

  $menu.ShowItemToolTips = $true
  # The header doubles as the copy button: pasting the MCP URL into a client is by far the most
  # frequent thing anyone does with this stack.
  $headerItem = Add-MenuItem 'MCP' {
    if (-not $McpUrl) { return }
    [System.Windows.Forms.Clipboard]::SetText($McpUrl)
    $notify.ShowBalloonTip(2000, 'AKI MCP', ('Copied {0}' -f $McpUrl), [System.Windows.Forms.ToolTipIcon]::Info)
  }
  $headerItem.ToolTipText = 'Click to copy the MCP URL'
  $headerItem.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
  Add-Separator
  $startItem = Add-MenuItem 'Start' { Invoke-Switch 'start' }
  $stopItem = Add-MenuItem 'Stop' { Invoke-Switch 'stop' }
  $restartItem = Add-MenuItem 'Restart' {
    Invoke-Switch 'stop'
    # Cloudflare's edge needs a moment to drop the old connector; restarting too fast serves 502s.
    Start-Sleep -Seconds 6
    Invoke-Switch 'start'
  }
  Add-Separator
  # The panel is only reachable with the token of the current boot, so the URL is read fresh
  # on every click rather than captured once at startup.
  $settingsItem = Add-MenuItem 'Settings...' {
    $url = Get-PanelUrl
    if (-not $url) {
      $notify.ShowBalloonTip(3000, 'AKI MCP', 'Start the server first - the panel token only exists while it runs.', [System.Windows.Forms.ToolTipIcon]::Warning)
      return
    }
    Start-Process $url
  }
  $logsItem = Add-MenuItem 'Open logs folder' {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Start-Process explorer.exe $LogDir
  }
  Add-Separator
  $showAtLoginItem = Add-MenuItem 'Show icon at startup' {
    Set-StartupLink (-not (Test-StartupEnabled)) (Test-AutoStartEnabled)
  }
  $autoStartItem = Add-MenuItem 'Start server at startup' {
    # Wanting the server at login implies wanting the icon there too.
    Set-StartupLink $true (-not (Test-AutoStartEnabled))
  }
  Add-Separator
  $exitItem = Add-MenuItem 'Exit' {
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }

  $script:lastRunning = $null

  function Update-Tray {
    $running = Test-StackRunning

    if ($script:lastRunning -ne $running) {
      if ($running) { $notify.Icon = $iconRunning } else { $notify.Icon = $iconStopped }
      $script:lastRunning = $running
    }

    if ($running) { $stateText = 'running' } else { $stateText = 'stopped' }
    # NotifyIcon.Text is capped at 63 characters by Windows.
    $notify.Text = 'MCP - {0}' -f $stateText
    if ($Origin) {
      $headerItem.Text = 'MCP - {0} - {1}' -f $stateText, $Origin
    } else {
      $headerItem.Text = 'MCP - {0}' -f $stateText
    }
    # Nothing to copy without an origin, and a dead item explains itself better than a silent click.
    $headerItem.Enabled = [bool]$McpUrl
    $startItem.Enabled = -not $running
    $stopItem.Enabled = $running
    $restartItem.Enabled = $running
    $settingsItem.Enabled = [bool](Get-PanelUrl)
    $showAtLoginItem.Checked = Test-StartupEnabled
    $autoStartItem.Checked = Test-AutoStartEnabled
  }

  $menu.Add_Opening({ Update-Tray })

  # NotifyIcon opens the menu on right-click by itself; the left button has to be wired up by hand.
  # ShowContextMenu is private, but calling it is still better than $menu.Show(): it places the menu
  # against the correct screen edge and lets it dismiss on focus loss, neither of which Show() does.
  $showContextMenu = $notify.GetType().GetMethod(
    'ShowContextMenu',
    [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic)

  $notify.Add_MouseUp({
    param($trayIcon, $mouse)
    if ($mouse.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    if ($showContextMenu) {
      $showContextMenu.Invoke($notify, $null)
    } else {
      $menu.Show([System.Windows.Forms.Cursor]::Position)
    }
  })

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 3000
  $timer.Add_Tick({ Update-Tray })

  # The first run installs the login shortcut by itself, so the icon is simply there after a reboot.
  # Starting the server stays opt-in, and either item can be unticked afterwards without coming back.
  if (-not (Test-Path $StartupMarker)) {
    New-Item -ItemType File -Force -Path $StartupMarker | Out-Null
    if (-not (Test-StartupEnabled)) {
      Set-StartupLink $true $false
      Write-TrayLog 'Installed the login shortcut (icon only).'
    }
  }

  Update-Tray
  $notify.Visible = $true
  $timer.Start()
  Write-TrayLog 'Tray started.'

  if ($AutoStart -and -not (Test-StackRunning)) { Invoke-Switch 'start' }

  try {
    [System.Windows.Forms.Application]::Run()
  } finally {
    $timer.Stop()
    $timer.Dispose()
    $notify.Visible = $false
    $notify.Dispose()
    $iconRunning.Dispose()
    $iconStopped.Dispose()
    if ($script:baseImage) { $script:baseImage.Dispose() }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
    Write-TrayLog 'Tray exited.'
  }
} catch {
  $details = ($_ | Out-String)
  Write-TrayLog ('FAILED: ' + $details)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($details, 'MCP tray failed to start')
  } catch { }
  exit 1
}
