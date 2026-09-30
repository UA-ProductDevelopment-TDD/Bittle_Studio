@echo off
rem Starts only the Bittle Link robot console (no simulator). Needs just Python.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" app\bittle_link.py %*
) else (
  python app\bittle_link.py %*
)
pause