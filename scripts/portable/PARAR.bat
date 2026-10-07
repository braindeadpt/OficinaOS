@echo off
chcp 65001 >nul
setlocal
title OficinaOS - Parar
cd /d "%~dp0"

echo  A parar o OficinaOS...
REM O ficheiro STOP impede o respawn do run-app.bat de reabrir a app
echo stopped>"%~dp0STOP"
powershell -NoProfile -Command "Get-Process bun -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0*' } | Stop-Process -Force" >nul 2>&1

REM %PGDATA% dentro de (...) expandia no parse, antes do FOR — o pg_ctl
REM corria com -D "" e o postgres ficava orfao (escondido pelo >nul).
REM Sem parens, %PGDATA% expande na linha seguinte, ja depois do set.
REM (Delayed expansion tambem resolvia, mas comia ! de caminhos.)
if exist "%~dp0data\PG_VERSION" for %%I in ("%~dp0data") do set "PGDATA=%%~sI"
if exist "%~dp0data\PG_VERSION" "%~dp0pgsql\bin\pg_ctl.exe" -D "%PGDATA%" stop -m fast >nul 2>&1
echo  Parado.
timeout /t 3 >nul
