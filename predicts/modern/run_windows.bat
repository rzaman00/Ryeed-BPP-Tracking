@echo off
setlocal
cd /d "%~dp0"

echo [BPP Predicts] Starting the newest build only...
if not exist ".venv\Scripts\python.exe" (
  echo [BPP Predicts] First run detected. Setting up automatically...
  call setup_windows.bat
  if errorlevel 1 exit /b 1
)

".venv\Scripts\python.exe" run_latest.py
if errorlevel 1 (
  echo.
  echo [BPP Predicts] Startup failed. Review the message above.
  pause
  exit /b 1
)
