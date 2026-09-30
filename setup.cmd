@echo off
rem One-time install: creates .venv with the Python packages and installs the 3D viewer library.
cd /d "%~dp0"
echo Installing Bittle Studio. Python 3.11 or 3.12 and Node.js are required.
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r app\requirements.txt
if errorlevel 1 exit /b 1
call npm.cmd install --prefix app --no-audit --no-fund
if errorlevel 1 exit /b 1
echo Ready. Double-click launch-studio.cmd.
pause