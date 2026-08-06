param(
  [string]$TaskName = "TFTAgent OP.GG Pro Pool Collect",
  [int]$IntervalMinutes = 60,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task: $TaskName"
  exit 0
}

$runner = (Resolve-Path (Join-Path $PSScriptRoot "run-opgg-collect.cmd")).Path
$action = New-ScheduledTaskAction -Execute $env:ComSpec -Argument "/d /c `"$runner`""
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Poll OP.GG tft_get_play_style for the NA pro pool and incrementally accumulate matches in local SQLite." `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  NextRunTime = $info.NextRunTime
  Runner = $runner
}
