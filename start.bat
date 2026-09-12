@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Setup has not been run. Starting setup now.
  call setup.bat
  if errorlevel 1 exit /b 1
)
call npm.cmd start
if errorlevel 1 (
  echo.
  echo The app closed after an error. Share a screenshot of this window.
  pause
)
