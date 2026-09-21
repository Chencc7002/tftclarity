$ErrorActionPreference = "Stop"

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$docker = if ($env:METATFT_SNAPSHOT_DOCKER_CLI) {
  $env:METATFT_SNAPSHOT_DOCKER_CLI
} elseif ($dockerCommand) {
  $dockerCommand.Source
} else {
  "C:\Users\Chencc\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
}

if (-not (Test-Path -LiteralPath $docker)) {
  throw "Docker CLI was not found. MetaTFT snapshots are PostgreSQL-only and require Docker Desktop."
}

function Test-DockerEngine {
  param(
    [int]$TimeoutSeconds = 5
  )

  $process = $null
  try {
    $process = Start-Process -FilePath $docker -ArgumentList @("info", "--format", "{{.ServerVersion}}") -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      return $false
    }
    return $process.ExitCode -eq 0
  } catch {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    return $false
  }
}

function Wait-DockerEngine {
  param(
    [int]$TimeoutSeconds = 180
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-DockerEngine) {
      return
    }

    Start-Sleep -Seconds 3
  }

  throw "Docker Desktop did not become ready within $TimeoutSeconds seconds."
}

function Get-DockerDesktopProcessIds {
  return @(
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessName -in @("Docker Desktop", "com.docker.backend") } |
      Select-Object -ExpandProperty Id
  )
}

function Start-DockerDesktopAndWait {
  param(
    [int]$TimeoutSeconds = 180
  )

  $process = Start-Process -FilePath $docker -ArgumentList @("desktop", "start") -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  try {
    while ([DateTime]::UtcNow -lt $deadline) {
      if (Test-DockerEngine) {
        return
      }

      if ($process.HasExited -and $process.ExitCode -ne 0) {
        throw "Docker Desktop failed to start (exit code $($process.ExitCode))."
      }

      Start-Sleep -Seconds 3
    }

    throw "Docker Desktop did not become ready within $TimeoutSeconds seconds."
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-DockerDesktopStartedByScript {
  param(
    [int[]]$ExistingProcessIds,
    [int]$TimeoutSeconds = 60
  )

  $stopProcess = $null
  try {
    $stopProcess = Start-Process -FilePath $docker -ArgumentList @("desktop", "stop") -PassThru -WindowStyle Hidden
    if (-not $stopProcess.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $stopProcess.Id -Force -ErrorAction SilentlyContinue
      Write-Warning "Docker Desktop stop timed out after $TimeoutSeconds seconds."
    } elseif ($stopProcess.ExitCode -ne 0) {
      Write-Warning "Docker Desktop could not be stopped automatically (exit code $($stopProcess.ExitCode))."
    }
  } catch {
    Write-Warning "Docker Desktop stop failed: $($_.Exception.Message)"
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $remainingProcessIds = @(Get-DockerDesktopProcessIds | Where-Object { $ExistingProcessIds -notcontains $_ })
    if ($remainingProcessIds.Count -eq 0) {
      return
    }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)

  Write-Warning "Stopping Docker Desktop processes created by this snapshot run after graceful shutdown did not complete."
  Stop-Process -Id $remainingProcessIds -Force -ErrorAction SilentlyContinue
}

$workspace = Split-Path -Parent $PSScriptRoot
$dockerStartedByScript = $false
$postgresStartedByScript = $false
$snapshotExitCode = 1
$dockerDesktopProcessIdsBeforeStart = @(Get-DockerDesktopProcessIds)

Push-Location $workspace
try {
  if (-not (Test-DockerEngine)) {
    if ($dockerDesktopProcessIdsBeforeStart.Count -gt 0) {
      Write-Host "Docker Desktop was already running; waiting for its Engine..."
      Wait-DockerEngine
    } else {
      Write-Host "Docker Engine is not running; starting Docker Desktop for this snapshot..."
      $dockerStartedByScript = $true
      Start-DockerDesktopAndWait
    }
  }

  $runningPostgresServices = @(& $docker compose ps --status running --services postgres)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not determine whether PostgreSQL was already running (exit code $LASTEXITCODE)."
  }
  $postgresWasRunning = $runningPostgresServices -contains "postgres"
  $postgresStartedByScript = -not $postgresWasRunning

  Write-Host "Ensuring PostgreSQL is healthy..."
  & $docker compose up -d --wait --no-recreate postgres
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL did not become healthy (exit code $LASTEXITCODE)."
  }

  & $docker compose run --build --no-deps app node scripts/capture-metatft-daily-snapshot.mjs @args
  $snapshotExitCode = $LASTEXITCODE
} catch {
  Write-Error $_
  $snapshotExitCode = 1
} finally {
  if ($dockerStartedByScript) {
    Write-Host "Snapshot run finished; stopping the Docker Desktop instance started by this script..."
    Stop-DockerDesktopStartedByScript -ExistingProcessIds $dockerDesktopProcessIdsBeforeStart
  } elseif ($postgresStartedByScript) {
    Write-Host "Snapshot run finished; stopping the PostgreSQL service started by this script..."
    & $docker compose stop postgres
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "PostgreSQL could not be stopped automatically (exit code $LASTEXITCODE)."
    }
  }

  Pop-Location
}

exit $snapshotExitCode
