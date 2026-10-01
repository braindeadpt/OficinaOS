@echo off
chcp 65001 >nul
setlocal
title OficinaOS - Parar
cd /d "%~dp0"

echo  A parar o OficinaOS...
powershell -NoProfile -Command "Get-Process bun -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0%' } | Stop-Process -Force" >nul 2>&1

if exist "%~dp0data\PG_VERSION" (
    "%~dp0pgsql\bin\pg_ctl.exe" -D "%~dp0data" stop -m fast >nul 2>&1
)
echo  Parado.
timeout /t 3 >nul
