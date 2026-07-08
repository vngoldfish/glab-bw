# G-Labs BW - start backend + frontend, open browser
$ErrorActionPreference = "Continue"
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

function Stop-Port([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.OwningProcess -gt 0) {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
}

function Test-Url([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-Key {
    Write-Host ""
    Write-Host "Nhan Enter de dong..."
    try {
        [void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    } catch {
        Read-Host | Out-Null
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  G-Labs BW - Khoi dong nhanh" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Don dep port cu..."
foreach ($p in 8765, 18923, 5173) { Stop-Port $p }
Start-Sleep -Seconds 1

Write-Host "[2/4] Backend :8765 + Auth :18923 ..."
$backendCmd = "`$env:PYTHONPATH='$Backend'; Set-Location '$Backend'; Write-Host 'G-Labs BW BACKEND - giu cua so nay mo' -ForegroundColor Green; python -m uvicorn app.main:app --host 127.0.0.1 --port 8765"
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $backendCmd
) -WorkingDirectory $Backend -WindowStyle Normal

$ok = $false
for ($i = 1; $i -le 25; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Url "http://127.0.0.1:8765/api/health") {
        $ok = $true
        break
    }
    Write-Host "  doi backend... $i"
}
if (-not $ok) {
    Write-Host "LOI: Backend khong len duoc. Kiem tra Python." -ForegroundColor Red
    Wait-Key
    exit 1
}
Write-Host "  Backend OK" -ForegroundColor Green

Write-Host "[3/4] Frontend :5173 ..."
$frontCmd = "Set-Location '$Frontend'; Write-Host 'G-Labs BW FRONTEND - giu cua so nay mo' -ForegroundColor Green; npm run dev -- --host 127.0.0.1 --port 5173"
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $frontCmd
) -WorkingDirectory $Frontend -WindowStyle Normal

$okF = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Url "http://127.0.0.1:5173/") {
        $okF = $true
        break
    }
    Write-Host "  doi frontend... $i"
}
if (-not $okF) {
    Write-Host "LOI: Frontend khong len. Chay npm install trong frontend?" -ForegroundColor Red
    Wait-Key
    exit 1
}
Write-Host "  Frontend OK" -ForegroundColor Green

Write-Host "[4/4] Mo trinh duyet..."
Start-Process "http://127.0.0.1:5173"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  App:     http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "  Backend: http://127.0.0.1:8765" -ForegroundColor Green
Write-Host "  Auth:    http://127.0.0.1:18923" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Giu 2 cua so PowerShell (BACKEND + FRONTEND) mo."
Write-Host "Dong 2 cua so do = tat app."
Write-Host ""
Write-Host "Cua so nay co the dong."
Wait-Key
