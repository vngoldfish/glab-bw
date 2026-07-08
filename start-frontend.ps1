function Stop-PortListener {
    param([int]$Port)
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.OwningProcess -gt 0) {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
}

Write-Host "Stopping old frontend process on port 5173..."
Stop-PortListener -Port 5173
Start-Sleep -Seconds 1

Set-Location $PSScriptRoot\frontend
Write-Host "Starting frontend on http://localhost:5173 ..."
npm run dev