@echo off
setlocal enabledelayedexpansion
title Stream Labs Quotation Tool

echo.
echo  ==================================================
echo   Stream Labs - Quotation Tool
echo   Checking dependencies...
echo  ==================================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    echo.
    echo Please install Python 3 from https://www.python.org/downloads/
    echo Make sure to check Add Python to PATH during installation.
    pause
    exit /b 1
)

:: Install required packages
echo Checking Python packages...

python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo   Installing Flask...
    python -m pip install flask --quiet
)

python -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    echo   Installing openpyxl...
    python -m pip install openpyxl --quiet
)

python -c "import PIL" >nul 2>&1
if errorlevel 1 (
    echo   Installing Pillow...
    python -m pip install Pillow --quiet
)

echo   All checks done.
echo.

:: ── Auto-backup data/*.json ────────────────────────────────
:: Creates data\backup\YYYY-MM-DD\ on every launch.
:: Keeps the last 30 daily backups, removes older ones.

set BACKUP_ROOT=%~dp0data\backup
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%"

:: Build today's date folder (YYYY-MM-DD) using PowerShell — works on all Windows versions
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%d
set BACKUP_DIR=%BACKUP_ROOT%\%TODAY%

if not exist "%BACKUP_DIR%" (
    mkdir "%BACKUP_DIR%"
    copy /Y "%~dp0data\*.json" "%BACKUP_DIR%\" >nul 2>&1
    echo   Backup created: data\backup\%TODAY%\
) else (
    echo   Backup for today already exists, skipping.
)

:: Remove backups older than 30 days (errors silently ignored)
powershell -NoProfile -Command "Get-ChildItem '%BACKUP_ROOT%' -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and [datetime]::ParseExact($_.Name,'yyyy-MM-dd',$null) -lt (Get-Date).AddDays(-30) } | Remove-Item -Recurse -Force" >nul 2>&1

echo.
echo  ==================================================
echo   Opening http://localhost:5000 in your browser...
echo   Press Ctrl+C in this window to stop the server.
echo  ==================================================
echo.

:: Open browser after short delay — read port from .port file written by server.py
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; $p = (Get-Content '%~dp0.port' -ErrorAction SilentlyContinue); if (-not $p) { $p = '5000' }; Start-Process ('http://localhost:' + $p.Trim())"

:: Start the server
python server.py
pause
