@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS
cd /d "%~dp0"

echo A iniciar o OficinaOS...
REM Docker pode estar instalado mas fora do PATH desta sessao
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        echo ERRO: Docker Desktop nao esta instalado. Corre primeiro o INSTALAR.bat
        pause
        exit /b 1
    )
    echo O Docker esta parado. A iniciar o Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    set /a TENT=0
    :esperar
    timeout /t 5 /nobreak >nul
    set /a TENT+=1
    docker info >nul 2>&1
    if not errorlevel 1 goto docker_pronto
    if !TENT! LSS 72 goto esperar
    echo ERRO: o Docker Desktop nao arrancou. Abre-o manualmente e tenta de novo.
    pause
    exit /b 1
    :docker_pronto
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
