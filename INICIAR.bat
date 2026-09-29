@echo off
chcp 65001 >nul
title OficinaOS
cd /d "%~dp0"

echo A iniciar o OficinaOS...
docker info >nul 2>&1
if errorlevel 1 (
    echo O Docker esta parado. A iniciar o Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    :esperar
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 goto esperar
)
REM Atualiza para a imagem mais recente (ignorado se offline)
docker compose -f docker-compose.app.yml pull >nul 2>&1
docker compose -f docker-compose.app.yml up -d >nul 2>&1
if errorlevel 1 docker compose up -d >nul 2>&1
if errorlevel 1 (
    echo ERRO ao iniciar. Se nunca instalaste, corre primeiro o INSTALAR.bat
    pause
    exit /b 1
)
start "" "http://localhost:4000"
exit /b 0
