@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS
cd /d "%~dp0"

echo A iniciar o OficinaOS...

REM Ja esta a correr?
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 (
    echo O OficinaOS ja esta a correr.
    call :abrir_app
    exit /b 0
)

REM Docker pode estar instalado mas fora do PATH desta sessao
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"
docker info >nul 2>&1
if not errorlevel 1 goto docker_pronto

where docker >nul 2>&1
if errorlevel 1 (
    echo ERRO: Docker Desktop nao esta instalado. Corre primeiro o INSTALAR.bat
    pause
    exit /b 1
)
echo O Docker esta parado. A iniciar o Docker Desktop...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
set /a TENT=0
:esperar_docker
ping -n 6 127.0.0.1 >nul
set /a TENT+=1
docker info >nul 2>&1
if not errorlevel 1 goto docker_pronto
if !TENT! LSS 48 goto esperar_docker
echo ERRO: o Docker Desktop nao arrancou. Abre-o manualmente e tenta de novo.
pause
exit /b 1

:docker_pronto
REM Instalacao em modo build (imagem ghcr indisponivel)? O source fica em
REM oficinaos-src\app-source — arranca esse compose.
if exist "%~dp0oficinaos-src\app-source\docker-compose.yml" (
    docker compose -f "%~dp0oficinaos-src\app-source\docker-compose.yml" up -d
    goto compose_feito
)
echo A verificar atualizacoes...
docker compose -f docker-compose.app.yml pull >nul 2>&1
docker compose -f docker-compose.app.yml up -d
if errorlevel 1 docker compose up -d
:compose_feito
if errorlevel 1 (
    echo ERRO ao iniciar. Se nunca instalaste, corre primeiro o INSTALAR.bat
    pause
    exit /b 1
)

REM Esperar que a app responda antes de abrir o browser
set /a TENT=0
:esperar_app
ping -n 4 127.0.0.1 >nul
set /a TENT+=1
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 goto app_pronta
if !TENT! LSS 30 goto esperar_app
echo A app ainda nao respondeu — pode estar a atualizar a base de dados.
echo Espera 1 minuto e abre http://localhost:4000 manualmente.
pause
exit /b 0

:app_pronta
call :abrir_app
exit /b 0

REM ── Abrir o browser ────────────────────────────────────────────────────
REM Em Docker o browser deste PC nao chega a app como 127.0.0.1, por isso o
REM ecra "Criar a sua oficina" precisa do SETUP_TOKEN do .env. Depois de a
REM oficina estar criada, /setup reencaminha sozinho para o login.
:abrir_app
set "OOS_URL=http://localhost:4000"
if exist "%~dp0.env" (
    for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"SETUP_TOKEN=" "%~dp0.env"`) do (
        if not "%%b"=="" set "OOS_URL=http://localhost:4000/setup?token=%%b"
    )
)
start "" "!OOS_URL!"
exit /b 0
