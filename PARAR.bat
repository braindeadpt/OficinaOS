@echo off
chcp 65001 >nul
title OficinaOS - Parar
cd /d "%~dp0"

echo A parar o OficinaOS...
docker compose stop
echo Parado. Os dados ficam guardados.
timeout /t 4
