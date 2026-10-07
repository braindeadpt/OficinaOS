@echo off
chcp 65001 >nul
setlocal
title OficinaOS - Parar
cd /d "%~dp0"

echo  A parar o OficinaOS...
REM O ficheiro STOP impede o respawn do run-app.bat de reabrir a app
echo stopped>"%~dp0STOP"
powershell -NoProfile -Command "Get-Process bun -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0*' } | Stop-Process -Force" >nul 2>&1

if exist "%~dp0data\PG_VERSION" (
    REM pg_ctl falha com acentos no caminho — nome 8.3 como no INICIAR.bat
    for %%I in ("%~dp0data") do set "PGDATA=%%~sI"
    "%~dp0pgsql\bin\pg_ctl.exe" -D "%PGDATA%" stop -m fast >nul 2>&1
)
echo  Parado.
timeout /t 3 >nul
