$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HotkeyScript = Join-Path $ScriptDir "small-window-hotkey.ps1"
$SmokeMutexName = "Local\TFTAgentSmallWindowHotkeySmoke"
$SmokeHotkey = "Ctrl+Alt+F24"

& $HotkeyScript `
  -Hotkey $SmokeHotkey `
  -MutexName $SmokeMutexName `
  -ExitAfterSeconds 1

[ordered]@{
  ok = $true
  hotkey = $SmokeHotkey
  mutexName = $SmokeMutexName
} | ConvertTo-Json -Compress
