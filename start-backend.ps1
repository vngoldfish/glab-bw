$backend = Join-Path $PSScriptRoot "backend"
$env:PYTHONPATH = $backend
Set-Location $backend

function Stop-PortListener {
    param([int]$Port)
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.OwningProcess -gt 0) {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
}

Write-Host "Stopping old backend processes on ports 8765 and 18923..."
Stop-PortListener -Port 8765
Stop-PortListener -Port 18923
Start-Sleep -Seconds 1

Write-Host "Starting Auth Bridge on http://127.0.0.1:18923 (Chrome extension)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:PYTHONPATH='$backend'; cd '$backend'; python -m uvicorn app.auth_bridge_main:app --host 127.0.0.1 --port 18923"

Start-Sleep -Seconds 1
Write-Host "Starting Web API on http://127.0.0.1:8765 ..."
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765