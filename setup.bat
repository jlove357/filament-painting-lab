@echo off
setlocal
cd /d "%~dp0"
echo Installing Filament Painting Lab...
echo The first setup may take several minutes.
echo.
call npm.cmd install
if errorlevel 1 (
  echo.
  echo Setup failed. Leave this window open and share a screenshot.
  pause
  exit /b 1
)
echo.
echo Setup complete. Double-click start.bat to open the app.
pause
