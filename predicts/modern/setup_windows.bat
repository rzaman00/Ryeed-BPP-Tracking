@echo off
setlocal
cd /d "%~dp0"

echo [BPP Predicts v2.5.0] Setting up local Python environment...
if not exist ".venv\Scripts\python.exe" (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -m venv .venv
  ) else (
    where python >nul 2>nul
    if errorlevel 1 (
      echo Python was not found. Install Python 3.11+ and make sure it is available in PATH.
      goto :fail
    )
    python -m venv .venv
  )
  if errorlevel 1 goto :fail
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env. Add APRSFI_API_KEY there to enable live tracking.
)

echo.
echo Setup complete. Run run_windows.bat or the top-level START_BPP_PREDICTS.bat.
exit /b 0

:fail
echo.
echo Setup failed. Check the error above.
exit /b 1
