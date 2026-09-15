@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.cmd first to install Bittle Studio.
  pause
  exit /b 1
)
echo Starting Bittle Studio at http://127.0.0.1:8765
echo Keep this window open. Press Ctrl+C here to stop the simulator.
".venv\Scripts\python.exe" launcher.py
pause
