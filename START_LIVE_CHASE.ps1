$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $Root "predicts\chasemapper")
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop is required for the complete Live CHASE system."
}
docker compose up -d --build
Start-Process "http://127.0.0.1:5001/"
Write-Host "Live CHASE is starting at http://127.0.0.1:5001/" -ForegroundColor Green
