# Autoplay watchdog for cxstudy-toolkit
#
# Why this exists: auto-play-cdp.mjs can hang on a CDP call when the page reloads.
# The process stays alive while the log stops growing. Running a whole course takes
# 10+ hours, so something has to restart it.
#
# IMPORTANT (learned the hard way, three separate times):
#   1. This script must be pure ASCII. Windows PowerShell 5.1 reads .ps1 using
#      $OutputEncoding (us-ascii here), so any non-ASCII byte corrupts the parser.
#   2. The repo path contains a space ("D:\deep seek工作区3"). PS 5.1's
#      Start-Process cannot get quotes through to the child process -- arrays drop
#      them, single strings swallow them (node then reports "bad option: --cpi"),
#      and prefixing with cmd.exe /c loses the /c switch and leaves an interactive
#      shell. So: use Start-Job, which takes an argument list as a real array.
#   3. The job must write to the log file itself, otherwise the log mtime never
#      changes and stall detection is impossible.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\supervise-autoplay.ps1 -Course 265874869 -Clazz 151629641 -Cpi 408361568

param(
  [Parameter(Mandatory = $true)][string]$Course,
  [Parameter(Mandatory = $true)][string]$Clazz,
  [string]$Cpi = '',
  [int]$Rate = 2,
  [int]$StallMinutes = 3,
  [int]$Port = 9222,
  [int]$MaxRestarts = 999
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $repoRoot 'autoplay.log'
$script = Join-Path $repoRoot 'scripts\auto-play-cdp.mjs'

function Now { (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
function Say($m) { Write-Host "[$(Now)] $m" }

if (-not (Test-Path $script)) { Say "ERROR: missing $script"; exit 1 }

# Build the argument array once; Start-Job passes arrays as real arrays.
$argList = @('--port', "$Port", '--course', $Course, '--clazz', $Clazz, '--rate', "$Rate")
if ($Cpi -ne '') { $argList += @('--cpi', $Cpi) }

Say "watchdog start"
Say "course=$Course clazz=$Clazz port=$Port rate=$Rate stall=${StallMinutes}min"
Say "log=$logFile"

for ($round = 1; $round -le $MaxRestarts; $round++) {
  Say "===== round $round ====="

  # Start-Job runs the player; inside the job we append every output line to the
  # log file, so the file mtime reflects actual player progress.
  $job = Start-Job -Name "cxplay$round" -ScriptBlock {
    param($nodeScript, $args_, $logPath)
    & node $nodeScript @args_ 2>&1 | ForEach-Object {
      try { $_ | Out-File -FilePath $logPath -Append -Encoding utf8 } catch {}
    }
  } -ArgumentList $script, $argList, $logFile

  Say "job id=$($job.Id) state=$($job.State)"

  while ($job.State -eq 'Running') {
    Start-Sleep -Seconds 30
    if (-not (Test-Path $logFile)) { continue }
    $age = (Get-Date) - (Get-Item $logFile).LastWriteTime
    if ($age.TotalMinutes -ge $StallMinutes) {
      $mins = [Math]::Round($age.TotalMinutes, 1)
      Say "log idle ${mins}min >= ${StallMinutes}min -> treat as hung, killing job"
      Stop-Job -Job $job -ErrorAction SilentlyContinue
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 5
      break
    }
  }

  if ($job.State -eq 'Completed' -or $job.State -eq 'Failed') {
    Say "job ended, state=$($job.State)"
  }
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

  if (Test-Path $logFile) {
    $tail = Get-Content $logFile -Tail 8 -ErrorAction SilentlyContinue
    if ($tail -match '=== END ===') {
      Say "found END marker -> all task points done, watchdog exits"
      break
    }
  }

  Say "restarting in 10s"
  Start-Sleep -Seconds 10
}

Say "watchdog end"
