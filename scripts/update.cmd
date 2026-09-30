@echo off
rem Gets the latest version from GitHub and refreshes the installed packages.
cd /d "%~dp0.."
git pull --ff-only
if errorlevel 1 (
  echo Could not update automatically. You may have local changes; ask for help or use GitHub Desktop.
  pause
  exit /b 1
)
call setup.cmd