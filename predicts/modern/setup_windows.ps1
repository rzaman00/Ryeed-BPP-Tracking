$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host "[BPP Predicts v3.2.1] Checking local Python environment..." -ForegroundColor Cyan

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$launcher = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { throw 'Python 3.11+ was not found in PATH.' }

function New-BppVenv {
    if (Test-Path '.venv') { Remove-Item '.venv' -Recurse -Force }
    & $launcher -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment.' }
}

if (Test-Path $venvPython) {
    & $venvPython -m pip --version *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[BPP Predicts] Existing pip is broken. Rebuilding the virtual environment...' -ForegroundColor Yellow
        New-BppVenv
    }
} else {
    New-BppVenv
}

& $venvPython -m ensurepip --upgrade *> $null
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { New-BppVenv; & $venvPython -m ensurepip --upgrade; & $venvPython -m pip install --upgrade pip }
& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& $venvPython -c 'import fastapi, uvicorn, httpx, dotenv, pydantic, shapely'
if ($LASTEXITCODE -ne 0) { throw 'Dependency verification failed.' }

if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host 'Created .env. Add APRSFI_API_KEY there to enable live tracking.' }
Write-Host 'Setup complete.' -ForegroundColor Green
