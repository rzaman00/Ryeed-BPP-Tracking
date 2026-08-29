$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Virtual environment not found. Run .\setup_windows.ps1 first." -ForegroundColor Red
    exit 1
}

Start-Process "http://127.0.0.1:8000"
& ".\.venv\Scripts\python.exe" app.py
