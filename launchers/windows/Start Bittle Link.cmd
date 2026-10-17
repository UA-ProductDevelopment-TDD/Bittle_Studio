@echo off
rem Starts only the Bittle Link robot console (no simulator). Uses Setup's Python, or else any Python 3.
cd /d "%~dp0..\.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" app\bittle_link.py %*
) else (
  python app\bittle_link.py %* || echo Run Setup first: it installs Python for Bittle Studio.
)
pause
