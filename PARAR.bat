@echo off
chcp 65001 >nul
title OficinaOS - Parar
cd /d "%~dp0"

echo A parar o OficinaOS...
docker compose -f docker-compose.app.yml stop >nul 2>&1
if errorlevel 1 docker compose stop
echo Parado. Os dados ficam guardados.
timeout /t 4
