@echo off
title G-Labs BW - Tat app
cd /d "%~dp0"
echo Dang tat backend + frontend...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$AUTH_PORT = 18923; $EnvFile = Join-Path '%~dp0' '.env'; if (Test-Path $EnvFile) { $envContent = Get-Content $EnvFile -Raw; if ($envContent -match 'AUTH_BRIDGE_URL=[^\r\n]+') { $url = $Matches[0].Split('=')[1].Trim(); if ($url -match ':(\d+)') { $AUTH_PORT = [int]$Matches[1] } } }; foreach ($port in 8765,$AUTH_PORT,5173) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 0) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } }; Write-Host 'Da tat xong.'"
echo.
echo  Xong. Nhan phim bat ky de dong.
pause >nul
