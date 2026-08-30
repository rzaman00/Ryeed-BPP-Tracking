$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "[BPP Predicts v2.3.0] Setting up local Python environment..." -ForegroundColor Cyan
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        py -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        python -m venv .venv
    } else {
        throw "Python 3.11+ was not found in PATH."
    }
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env. Add APRSFI_API_KEY there to enable live tracking." -ForegroundColor Yellow
}

Write-Host "Setup complete. Run .\run_windows.ps1 or the top-level START_BPP_PREDICTS.bat." -ForegroundColor Green
