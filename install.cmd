@echo off
REM ============================================================
REM  chaoxing-assistant  installer  (Windows launcher)
REM
REM  Double-click this file. It does three things:
REM    1. check Node >= 22
REM    2. hand over to install.ps1 (which registers the cxa command)
REM    3. report the result
REM
REM  ASCII-ONLY ON PURPOSE.
REM  cmd.exe parses the batch file before any "chcp 65001" takes effect,
REM  so UTF-8 Chinese in this file would be read as GBK and turn into
REM  garbage that can break the parser. All Chinese docs live in
REM  README.md and llms.txt instead.
REM ============================================================

setlocal

cd /d "%~dp0"

echo.
echo  ============================================
echo   chaoxing-assistant  installer
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js not found.
  echo      Install Node 22 or newer from https://nodejs.org
  echo.
  pause
  exit /b 2
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [i] Node found: %NODE_VER%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set RC=%ERRORLEVEL%

echo.
if %RC% neq 0 (
  echo  [X] Install failed with code %RC%
  echo      See the messages above for what went wrong.
) else (
  echo  [OK] Done.
  echo       Open a NEW terminal and run:  cxa auth login
)
echo.
pause
exit /b %RC%
