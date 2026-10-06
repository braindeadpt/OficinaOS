@echo off
chcp 65001 >nul
title OficinaOS - Parar
cd /d "%~dp0"

echo A parar o OficinaOS...
REM Instalacao em modo build (sem imagem ghcr)? O compose vive no source.
if exist "%~dp0oficinaos-src\app-source\docker-compose.yml" (
    docker compose -f "%~dp0oficinaos-src\app-source\docker-compose.yml" stop >nul 2>&1
)
docker compose -f docker-compose.app.yml stop >nul 2>&1
if errorlevel 1 docker compose stop
echo Parado. Os dados ficam guardados.
timeout /t 4
