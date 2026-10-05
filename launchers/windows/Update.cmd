@echo off
rem Gets the latest version from GitHub, then refreshes the installed packages.
cd /d "%~dp0..\.."
set "PY="
for %%v in (3.12 3.11 3.10) do if not defined PY (py -%%v -c "" >nul 2>&1 && set "PY=py -%%v")
if not defined PY (python -c "" >nul 2>&1 && set "PY=python")
if not defined PY (
  echo Python 3.11 or 3.12 is needed. Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)
%PY% app\install.py --update
pause
