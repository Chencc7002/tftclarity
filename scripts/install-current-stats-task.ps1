param(
  [string]$TaskName = "TFTAgent Current Stats Daily",
  [string]$At = "04:15",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task: $TaskName"
  exit 0
}

if ($At -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') {
  throw "-At must use HH:mm"
}

$runner = (Resolve-Path (Join-Path $PSScriptRoot "run-current-stats-daily.cmd")).Path
$time = [DateTime]::Today.AddHours([int]$At.Substring(0, 2)).AddMinutes([int]$At.Substring(3, 2))
$action = New-ScheduledTaskAction -Execute $env:ComSpec -Argument "/d /c `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Generate and index MetaTFT current_stats with lock, retries, manifest and optional webhook alert." `
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
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  Runner = $runner
}
