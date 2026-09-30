@echo off
cd /d "%~dp0"
rem Bittle Link needs only Python's standard library; the Studio .venv is used when present.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" bittle_link.py %*
) else (
  python bittle_link.py %*
)
pause
