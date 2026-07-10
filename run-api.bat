@echo off
setlocal
set PYTHONPATH=%~dp0backend
cd /d "%~dp0backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8765
endlocal
