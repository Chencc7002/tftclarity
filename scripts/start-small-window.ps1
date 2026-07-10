param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 17317,
  [int]$Width = 460,
  [int]$Height = 760,
  [int]$WindowLeft = 40,
  [int]$WindowTop = 40,
  [switch]$TopMost,
  [switch]$NoBrowser,
  [switch]$NoHotkey,
  [string]$Hotkey = "Ctrl+Shift+Space",
  [string]$BrowserPath = "",
  [string]$NodePath = "",
  [ValidateSet("", "json", "sqlite")]
  [string]$CacheStore = "",
  [string]$CachePath = "",
  [int]$WaitSeconds = 12,
  [int]$TopMostWaitSeconds = 8
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$CacheDir = Join-Path $RootDir ".cache"
$ServerScript = Join-Path $RootDir "src\app\small-window-server.js"
$HotkeyScript = Join-Path $RootDir "scripts\small-window-hotkey.ps1"
$Url = "http://${HostName}:$Port/"
$HealthUrl = "http://${HostName}:$Port/api/health"

function Ensure-Directory($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Test-Health {
  param([string]$TargetUrl)
  try {
    $response = Invoke-RestMethod -Uri $TargetUrl -TimeoutSec 2
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Resolve-Node {
  param([string]$ExplicitPath)
  if ($ExplicitPath) {
    if (Test-Path -LiteralPath $ExplicitPath) { return (Resolve-Path -LiteralPath $ExplicitPath).Path }
    throw "NodePath not found: $ExplicitPath"
  }

  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "node.exe was not found. Install Node.js 18+ or pass -NodePath."
}

function Resolve-Browser {
  param([string]$ExplicitPath)
  if ($ExplicitPath) {
    if (Test-Path -LiteralPath $ExplicitPath) { return (Resolve-Path -LiteralPath $ExplicitPath).Path }
    throw "BrowserPath not found: $ExplicitPath"
  }

  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) { return $candidates[0] }
  throw "Microsoft Edge or Google Chrome was not found. Pass -BrowserPath or use -NoBrowser."
}

function Start-DetachedProcess {
  param(
    [string]$FileName,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [int]$WindowStyle = 0
  )

  $shell = New-Object -ComObject WScript.Shell
  $previousLocation = Get-Location
  try {
    Set-Location -LiteralPath $WorkingDirectory
    $command = "`"$FileName`" $Arguments"
    [void]$shell.Run($command, $WindowStyle, $false)
  } finally {
    Set-Location -LiteralPath $previousLocation
  }
}

function Get-ListeningPid {
  param([int]$TargetPort)
  $pattern = "^\s*TCP\s+\S+:$TargetPort\s+\S+\s+LISTENING\s+(\d+)\s*$"
  foreach ($line in netstat -ano) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }
  return $null
}

function Set-TopMostWindow {
  param(
    [string]$TitlePattern = "TFTAgent",
    [int]$Left = 40,
    [int]$Top = 40,
    [int]$TargetWidth = 460,
    [int]$TargetHeight = 760,
    [int]$WaitSeconds = 8
  )

  $typeName = "TFTAgentWin32WindowTools"
  if (-not ($typeName -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TFTAgentWin32WindowTools {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr hWndInsertAfter,
    int X,
    int Y,
    int cx,
    int cy,
    uint uFlags
  );
}
"@
  }

  $hwndTopMost = [IntPtr](-1)
  $swpShowWindow = 0x0040
  $deadline = (Get-Date).AddSeconds($WaitSeconds)

  while ((Get-Date) -lt $deadline) {
    $windows = Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -ne 0 -and
        $_.MainWindowTitle -like "*$TitlePattern*" -and
        ($_.ProcessName -like "msedge*" -or $_.ProcessName -like "chrome*")
      }

    foreach ($window in $windows) {
      $applied = [TFTAgentWin32WindowTools]::SetWindowPos(
        $window.MainWindowHandle,
        $hwndTopMost,
        $Left,
        $Top,
        $TargetWidth,
        $TargetHeight,
        $swpShowWindow
      )
      if ($applied) {
        return [ordered]@{
          applied = $true
          processId = $window.Id
          title = $window.MainWindowTitle
        }
      }
    }

    Start-Sleep -Milliseconds 250
  }

  return [ordered]@{
    applied = $false
    processId = $null
    title = $null
  }
}

Ensure-Directory $CacheDir

$serverStarted = $false
if (-not (Test-Health $HealthUrl)) {
  $node = Resolve-Node $NodePath
  $serverArgs = "src/app/small-window-server.js --host $HostName --port $Port"
  if ($CacheStore) {
    $serverArgs = "$serverArgs --cache-store $CacheStore"
  }
  if ($CachePath) {
    $serverArgs = "$serverArgs --cache-path `"$CachePath`""
  }

  Start-DetachedProcess `
    -FileName $node `
    -Arguments $serverArgs `
    -WorkingDirectory $RootDir `
    -WindowStyle 0
  $serverStarted = $true
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-Health $HealthUrl) { break }
  Start-Sleep -Milliseconds 250
}

if (-not (Test-Health $HealthUrl)) {
  throw "TFTAgent small window server did not become healthy at $HealthUrl"
}

$browserProcess = $null
$topMostResult = $null
$hotkeyStarted = $false
if (-not $NoBrowser) {
  $browser = Resolve-Browser $BrowserPath
  $profileDir = Join-Path $CacheDir "small-window-browser-profile"
  Ensure-Directory $profileDir
  $browserArgs = "--app=$Url --window-size=$Width,$Height --window-position=$WindowLeft,$WindowTop --user-data-dir=`"$profileDir`""
  Start-DetachedProcess `
    -FileName $browser `
    -Arguments $browserArgs `
    -WorkingDirectory $RootDir `
    -WindowStyle 1
  $browserProcess = $true

  if ($TopMost) {
    $topMostResult = Set-TopMostWindow `
      -TitlePattern "TFTAgent" `
      -Left $WindowLeft `
      -Top $WindowTop `
      -TargetWidth $Width `
      -TargetHeight $Height `
      -WaitSeconds $TopMostWaitSeconds
  }

  if (-not $NoHotkey -and $Hotkey) {
    $powershell = Join-Path $PSHOME "powershell.exe"
    $hotkeyArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$HotkeyScript`" -TitlePattern `"TFTAgent`" -Hotkey `"$Hotkey`""
    Start-DetachedProcess `
      -FileName $powershell `
      -Arguments $hotkeyArgs `
      -WorkingDirectory $RootDir `
      -WindowStyle 0
    $hotkeyStarted = $true
  }
}

$result = [ordered]@{
  ok = $true
  url = $Url
  healthUrl = $HealthUrl
  serverStarted = $serverStarted
  serverPid = Get-ListeningPid $Port
  browserStarted = [bool]$browserProcess
  browserPid = $null
  topMostRequested = [bool]$TopMost
  topMostApplied = [bool]($topMostResult -and $topMostResult.applied)
  topMostWindowPid = $topMostResult.processId
  topMostWindowTitle = $topMostResult.title
  hotkeyRequested = [bool](-not $NoHotkey -and -not $NoBrowser -and $Hotkey)
  hotkeyStarted = $hotkeyStarted
  hotkey = if ($NoHotkey -or $NoBrowser) { $null } else { $Hotkey }
  windowLeft = $WindowLeft
  windowTop = $WindowTop
  windowWidth = $Width
  windowHeight = $Height
}

$result | ConvertTo-Json -Compress
