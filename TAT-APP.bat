@echo off
title G-Labs BW - Tat app
cd /d "%~dp0"
echo Dang tat backend + frontend...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($port in 8765,18923,5173) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 0) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } }; Write-Host 'Da tat xong.'"
echo.
echo  Xong. Nhan phim bat ky de dong.
pause >nul
