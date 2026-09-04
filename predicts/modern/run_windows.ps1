$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "[BPP Predicts] First run detected. Setting up automatically..." -ForegroundColor Cyan
    & ".\setup_windows.ps1"
}

& ".\.venv\Scripts\python.exe" run_latest.py
