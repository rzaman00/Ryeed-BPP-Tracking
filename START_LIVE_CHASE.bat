@echo off
setlocal
cd /d "%~dp0predicts\chasemapper"
where docker >nul 2>nul || (
  echo Docker Desktop is required for the complete Live CHASE system.
  pause
  exit /b 1
)
docker compose up -d --build || (
  echo Live CHASE failed to start. Review the Docker output above.
  pause
  exit /b 1
)
start "" http://127.0.0.1:5001/
echo Live CHASE is starting at http://127.0.0.1:5001/
pause
