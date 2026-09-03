@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "BUILD_VERSION=3.4.1"
echo [BPP Predicts] Starting stable build v%BUILD_VERSION%...

rem Do not reuse a virtual environment from an older package. This avoids
rem stale/broken pip installs surviving across Predicts upgrades.
if exist ".venv\Scripts\python.exe" (
  set "VENV_BUILD="
  if exist ".venv\.bpp_build" set /p VENV_BUILD=<".venv\.bpp_build"
  if not "!VENV_BUILD!"=="%BUILD_VERSION%" (
    echo [BPP Predicts] Previous Python environment detected. Rebuilding it for v%BUILD_VERSION%...
    rmdir /s /q ".venv"
  )
)

if not exist ".venv\Scripts\python.exe" (
  call setup_windows.bat
  if errorlevel 1 goto :fail
) else (
  ".venv\Scripts\python.exe" -m pip --version >nul 2>nul
  if errorlevel 1 (
    echo [BPP Predicts] pip is damaged. Rebuilding the Python environment...
    rmdir /s /q ".venv"
    call setup_windows.bat
    if errorlevel 1 goto :fail
  )
  ".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, dotenv, pydantic, shapely" >nul 2>nul
  if errorlevel 1 (
    echo [BPP Predicts] Runtime dependencies are incomplete. Repairing...
    call setup_windows.bat
    if errorlevel 1 goto :fail
  )
)

".venv\Scripts\python.exe" run_latest.py
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [BPP Predicts] Startup failed. Review the message above.
pause
exit /b 1
