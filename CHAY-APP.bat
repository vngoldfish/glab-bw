@echo off
chcp 65001 >nul
title G-Labs BW - Chay app
cd /d "%~dp0"
echo.
echo  Dang khoi dong G-Labs BW...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"
if errorlevel 1 (
  echo.
  echo  Co loi. Nhan phim bat ky de dong.
  pause >nul
)
