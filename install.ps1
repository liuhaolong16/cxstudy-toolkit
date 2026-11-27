# chaoxing-assistant installer (PowerShell)
#
# ASCII-ONLY ON PURPOSE.
# Windows PowerShell 5.1 decodes a .ps1 file as ANSI when it has no BOM.
# Any UTF-8 Chinese text in this file - even inside a comment - can be mangled
# into bytes that break brace matching, and the whole script fails to parse
# with "Unexpected token '}'". That happened during development; keeping this
# file pure ASCII is the fix. Chinese docs live in README.md and llms.txt.
#
# What it does:
#   1. verify Node >= 22
#   2. verify the project files are intact
#   3. register the `cxa` command (npm link, falls back to a local shim)
#   4. smoke test
#
# Exit codes: 0 ok / 2 node missing or too old / 3 files missing / 4 link failed

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "  [..] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Bad($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

Write-Host ""
Write-Step "project root: $Root"

# ---------------------------------------------------------------- 1. Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Bad "Node.js not found. Install Node 22+ from https://nodejs.org"
  exit 2
}

$rawVer = (& node -v).Trim()
$major  = [int](($rawVer -replace '^v', '') -split '\.')[0]
Write-Step "Node $rawVer (major=$major)"
if ($major -lt 22) {
  Write-Bad "Node $rawVer is too old. This project needs Node >= 22."
  exit 2
}
Write-Ok "Node version OK"

# ---------------------------------------------------------------- 2. Files
$required = @(
  'package.json',
  'src\cli.mjs',
  'mcp\server.mjs',
  'src\api\materials.mjs'
)
$missing = @()
foreach ($f in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root $f))) { $missing += $f }
}
if ($missing.Count -gt 0) {
  Write-Bad ("missing files: " + ($missing -join ', '))
  Write-Bad "the download is incomplete - re-clone the repo"
  exit 3
}
Write-Ok "project files intact"

# ---------------------------------------------------------------- 3. bin
Write-Step "registering command cxa ..."
$linked = $false
try {
  $out = & npm link 2>&1
  if ($LASTEXITCODE -eq 0) {
    $linked = $true
    Write-Ok "npm link done"
  } else {
    Write-Host ("  [!] npm link failed: " + ($out | Select-Object -Last 3)) -ForegroundColor Yellow
  }
} catch {
  Write-Host ("  [!] npm link threw: " + $_.Exception.Message) -ForegroundColor Yellow
}

if (-not $linked) {
  Write-Host ""
  Write-Host "  Could not register cxa automatically. Alternatives:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "    A) run the CLI directly, no install:"
  Write-Host "         node `"$Root\src\cli.mjs`" auth login"
  Write-Host ""
  Write-Host "    B) use the generated shim:"
  Write-Host "         $Root\bin\cxa.cmd auth login"
  Write-Host ""

  # Create a shim so option B works immediately.
  $binDir = Join-Path $Root 'bin'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $shim = Join-Path $binDir 'cxa.cmd'
  $shimBody = "@echo off`r`nnode `"$Root\src\cli.mjs`" %*`r`n"
  Set-Content -LiteralPath $shim -Value $shimBody -Encoding ASCII
  Write-Ok "created shim: $shim"
  exit 4
}

# ---------------------------------------------------------------- 4. smoke
Write-Step "smoke test ..."
$smokeOk = $false
try {
  $null = & cxa 2>&1
  $smokeOk = $true
} catch {
  $smokeOk = $false
}

if ($smokeOk) {
  Write-Ok "cxa responds"
} else {
  Write-Host "  [!] cxa did not respond" -ForegroundColor Yellow
  exit 4
}

Write-Host ""
Write-Ok "installation complete"
Write-Host ""
Write-Host "  next steps:" -ForegroundColor Cyan
Write-Host "    1. open a NEW terminal (PATH refreshes only in new shells)"
Write-Host "    2. cxa auth login      <- opens a browser, log in manually"
Write-Host "    3. cxa auth status     <- verify session"
Write-Host "    4. cxa courses         <- list your courses"
Write-Host ""
Write-Host "  AI clients: see llms.txt - drop the repo URL into any AI and it can read that file"
Write-Host ""
exit 0
