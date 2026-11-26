# 超星自动连播 - Chrome 扩展一键安装助手
#
# 用途：在没有外网（Chrome 应用商店打不开）的环境下，帮你把本地扩展装进 Chrome。
#
# 为什么需要它：Tampermonkey 需要访问 chromewebstore.google.com 才能安装，
#   很多校园网/内网环境访问不了；而「开发者模式 + 加载已解包扩展」完全离线。
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
#
# 输出用英文，避免 PowerShell 控制台编码导致中文乱码。

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "[x] $msg" -ForegroundColor Red }

# ---------- 1. 定位扩展目录 ----------
$repoRoot = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $repoRoot 'extension'

Write-Step "Extension directory: $extDir"

if (-not (Test-Path $extDir)) {
    Write-Err2 "Extension directory not found. Run this script from the repo root (scripts\install-extension.ps1)."
    exit 1
}

$manifest = Join-Path $extDir 'manifest.json'
$content = Join-Path $extDir 'content.js'

foreach ($f in @($manifest, $content)) {
    if (-not (Test-Path $f)) {
        Write-Err2 "Missing file: $f"
        exit 1
    }
}
Write-Ok "manifest.json + content.js found"

# 简单校验 manifest 可解析
try {
    $m = Get-Content $manifest -Raw | ConvertFrom-Json
    Write-Ok "Extension: $($m.name) v$($m.version)"
} catch {
    Write-Err2 "manifest.json is not valid JSON: $_"
    exit 1
}

# ---------- 2. 定位 Chrome ----------
$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
    Write-Err2 "Chrome not found. Install Google Chrome first, or open chrome://extensions manually in your Chromium browser."
    exit 1
}
Write-Ok "Chrome: $chrome"

# ---------- 3. 打开扩展管理页 ----------
Write-Step "Opening chrome://extensions ..."

# 注意：chrome.exe 命令行会忽略 chrome:// 开头的 URL，只能先开窗口再让用户/脚本导航。
# 这里用剪贴板 + 模拟按键输入，避开中文输入法把半角冒号打成全角的问题。
try {
    Add-Type -AssemblyName System.Windows.Forms
    Start-Process -FilePath $chrome -ArgumentList '--new-window', 'about:blank'
    Start-Sleep -Seconds 2

    $wshell = New-Object -ComObject WScript.Shell
    $wshell.AppActivate('Chrome') | Out-Null
    Start-Sleep -Milliseconds 700

    Set-Clipboard -Value 'chrome://extensions'
    Start-Sleep -Milliseconds 300

    [System.Windows.Forms.SendKeys]::SendWait('^l')
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Seconds 2

    Write-Ok "chrome://extensions opened"
} catch {
    Write-Warn2 "Auto-navigation failed ($_). Please open chrome://extensions manually."
}

# ---------- 4. 打印操作指引 ----------
Write-Host ''
Write-Host '================================================================' -ForegroundColor White
Write-Host '  MANUAL STEPS (3 clicks, takes ~10 seconds)' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor White
Write-Host ''
Write-Host '  1) Turn ON "Developer mode" (top-right toggle)' -ForegroundColor White
Write-Host ''
Write-Host "  2) Click 'Load unpacked' (top-left button)" -ForegroundColor White
Write-Host ''
Write-Host '  3) Paste this folder path into the dialog and confirm:' -ForegroundColor White
Write-Host ''
Write-Host "     $extDir" -ForegroundColor Yellow
Write-Host ''
Write-Host '================================================================' -ForegroundColor White
Write-Host ''
Write-Warn2 'Do NOT use Notepad to copy the extension files - it may add a BOM and break them.'
Write-Host ''

# 把路径放进剪贴板，方便第 3 步直接 Ctrl+V
try {
    Set-Clipboard -Value $extDir
    Write-Ok "Extension path copied to clipboard - just press Ctrl+V in the folder dialog."
} catch {
    Write-Warn2 "Could not copy path to clipboard; copy it manually."
}

Write-Host ''
Write-Host 'After loading, an extension named "超星自动连播" should appear in the list.' -ForegroundColor White
Write-Host 'Then open a chaoxing video page - a panel appears at the bottom-right.' -ForegroundColor White
