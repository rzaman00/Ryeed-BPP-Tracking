@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py"
if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
  echo Python was not found. Install Python 3.11+ and make sure it is available in PATH.
  goto :fail
)

echo [BPP Predicts v3.2.1] Checking local Python environment...

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m pip --version >nul 2>nul
  if errorlevel 1 (
    echo [BPP Predicts] Existing virtual environment has a broken pip installation. Rebuilding it...
    rmdir /s /q ".venv"
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [BPP Predicts] Creating a fresh virtual environment...
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 goto :fail
)

".venv\Scripts\python.exe" -m ensurepip --upgrade >nul 2>nul
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :rebuild
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, dotenv, pydantic, shapely" >nul 2>nul
if errorlevel 1 goto :fail

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env. Add APRSFI_API_KEY there to enable live tracking.
)

echo.
> ".venv\.bpp_build" echo 3.2.1
echo Setup complete. Run run_windows.bat or the top-level START_BPP_PREDICTS.bat.
exit /b 0

:rebuild
echo [BPP Predicts] pip could not be repaired in place. Rebuilding the virtual environment once...
rmdir /s /q ".venv"
%PYTHON_CMD% -m venv .venv
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m ensurepip --upgrade
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :fail
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :fail
goto :verify_after_rebuild

:verify_after_rebuild
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, dotenv, pydantic, shapely" >nul 2>nul
if errorlevel 1 goto :fail
if not exist ".env" copy /Y ".env.example" ".env" >nul
echo.
> ".venv\.bpp_build" echo 3.2.1
echo Setup complete after rebuilding the virtual environment.
exit /b 0

:fail
echo.
echo Setup failed. Check the error above.
exit /b 1
