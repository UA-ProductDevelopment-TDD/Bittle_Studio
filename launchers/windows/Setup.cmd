@echo off
rem Install once, and again after getting a new version. Downloads uv and, with it, Python into .tools
rem (see app\setup-versions.txt), then app\install.py makes the Python environment and installs the packages.
rem No Python, compiler or administrator rights are needed beforehand.
setlocal
cd /d "%~dp0..\.."
for /f "eol=# tokens=1,2" %%a in (app\setup-versions.txt) do set "PIN_%%a=%%b"
set "UV=%CD%\.tools\uv\uv.exe"
set "UV_PYTHON_INSTALL_DIR=%CD%\.tools\python"
set "UV_MANAGED_PYTHON=1"
set "UV_PYTHON_INSTALL_BIN=0"
set "UV_PYTHON_INSTALL_REGISTRY=0"
set "UV_SYSTEM_CERTS=1"
rem Always the Intel/AMD Python: Windows on Arm runs it too, and every package has a ready-made version for it.
set "PYTHON=cpython-%PIN_python%-windows-x86_64-none"
if not exist "%UV%" call :get_uv || goto stopped
"%UV%" python install %PYTHON% || goto stopped
rem Through a file, not "for /f": a folder name with brackets, such as "Bittle Studio (1)", would break that.
"%UV%" python find --system %PYTHON% > ".tools\python-path.txt" || goto stopped
set /p PY=<".tools\python-path.txt"
"%PY%" app\install.py
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%

:get_uv
echo.
echo === Downloading uv %PIN_uv% (it installs Python for Bittle Studio) ===
if not exist ".tools\uv" mkdir ".tools\uv"
"%SystemRoot%\System32\curl.exe" -fL# --retry 3 -o ".tools\uv.zip" "https://github.com/astral-sh/uv/releases/download/%PIN_uv%/uv-x86_64-pc-windows-msvc.zip" || exit /b 1
certutil -hashfile ".tools\uv.zip" SHA256 | findstr /i /x "%PIN_uv-x86_64-pc-windows-msvc.zip%" >nul || (
  del ".tools\uv.zip"
  echo The downloaded uv does not match its checksum in app\setup-versions.txt.
  exit /b 1
)
"%SystemRoot%\System32\tar.exe" -xf ".tools\uv.zip" -C ".tools\uv" uv.exe || exit /b 1
del ".tools\uv.zip"
exit /b 0

:stopped
echo.
echo Setup stopped: Python for Bittle Studio could not be installed. Check the internet connection and run Setup again.
pause
exit /b 1
