@echo off
cd /d "%~dp0"
echo Installing Bittle Studio. Python 3.11 or 3.12 and Node.js are required.
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
call npm.cmd install --no-audit --no-fund
if errorlevel 1 exit /b 1
echo Ready. Double-click launch.cmd.
pause
