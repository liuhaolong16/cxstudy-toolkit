# 自动连播看门狗
#
# 为什么需要它：auto-play-cdp.mjs 在页面重载时可能卡死在某个 CDP 调用上，
# 进程还活着、日志却不再增长。整门课要跑十几个小时，必须有人把它拽起来。
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\supervise-autoplay.ps1 -Course 265874869 -Clazz 151629641 -Cpi 408361568
#
# 参数：
#   -Course / -Clazz / -Cpi   课程与班级 id（必填）
#   -Rate                     播放倍速，默认 2
#   -StallMinutes             日志多久没增长算卡死，默认 3
#   -Port                     CDP 端口，默认 9222
#   -MaxRestarts              最多重启几次，默认 999

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

Say "看门狗启动"
Say "课程 $Course / 班级 $Clazz / 端口 $Port / 倍速 $Rate"
Say "日志 $logFile"

# 主循环：拉起 → 监控 → 卡死就重启
for ($round = 1; $round -le $MaxRestarts; $round++) {
  Say "===== 第 $round 轮启动 ====="

  $args = @(
    $script,
    '--port', $Port,
    '--course', $Course,
    '--clazz', $Clazz,
    '--rate', $Rate
  )
  if ($Cpi) { $args += @('--cpi', $Cpi) }

  # 追加写日志，保留历史轮次
  $proc = Start-Process -FilePath 'node' -ArgumentList $args -PassThru -NoNewWindow `
    -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

  Say "node PID = $($proc.Id)"

  # 监控：每 30 秒看一眼日志有没有长
  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 30
    if (-not (Test-Path $logFile)) { continue }
    $age = (Get-Date) - (Get-Item $logFile).LastWriteTime
    if ($age.TotalMinutes -ge $StallMinutes) {
      Say "日志已 $([Math]::Round($age.TotalMinutes,1)) 分钟没增长 → 判定卡死，杀掉重启"
      try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Seconds 5
      break
    }
  }

  if ($proc.HasExited) {
    Say "进程自行退出，退出码 $($proc.ExitCode)"
  }

  # 检查是否真的全结束了（没有未完成任务点）
  if (Test-Path $logFile) {
    $tail = Get-Content $logFile -Tail 5 -ErrorAction SilentlyContinue
    if ($tail -match '没有未完成的任务点' -or $tail -match '全部结束') {
      Say "检测到「没有未完成的任务点」，全部结束，看门狗退出"
      break
    }
  }

  Say "10 秒后重启"
  Start-Sleep -Seconds 10
}

Say "看门狗结束"
