@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS - Instalacao
cd /d "%~dp0"

echo.
echo  ============================================
echo    OficinaOS - Instalacao automatica
echo    Gestao de reparacao de telemoveis
echo  ============================================
echo.

REM ── 1. Docker Desktop ──────────────────────────────────────────────────
echo [1/4] A verificar o Docker...
REM Docker pode estar instalado mas fora do PATH desta sessao
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        where winget >nul 2>&1
        if errorlevel 1 (
            echo.
            echo  Docker Desktop nao encontrado e o instalador automatico
            echo  ^(winget^) nao existe neste Windows.
            echo  Instala o Docker Desktop em:
            echo  https://www.docker.com/products/docker-desktop/
            echo  e volta a correr este ficheiro.
            pause
            exit /b 1
        )
        echo        Docker Desktop nao encontrado. A instalar (pode demorar)...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        if errorlevel 1 (
            echo.
            echo  ERRO: nao consegui instalar o Docker automaticamente.
            echo  Instala manualmente em https://www.docker.com/products/docker-desktop/
            echo  e volta a correr este ficheiro.
            pause
            exit /b 1
        )
        echo.
        echo  Docker Desktop instalado. Se o Windows pedir para reiniciar,
        echo  reinicia o PC e volta a correr o INSTALAR.bat.
        echo.
    )
    echo        A iniciar o Docker Desktop (primeira vez pode demorar 1-2 min)...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    set /a TENT=0
    :esperar_docker
    timeout /t 5 /nobreak >nul
    set /a TENT+=1
    docker info >nul 2>&1
    if not errorlevel 1 goto docker_ok
    if !TENT! LSS 72 goto esperar_docker
    echo.
    echo  ERRO: o Docker Desktop nao respondeu.
    echo  Se o Windows pediu para reiniciar, reinicia o PC e volta a correr
    echo  o INSTALAR.bat. Se ja reiniciaste, abre o Docker Desktop
    echo  manualmente, espera que arranque, e repete a instalacao.
    pause
    exit /b 1
    :docker_ok
)
echo        Docker OK.

REM ── 2. Configuracao (.env) ─────────────────────────────────────────────
echo [2/4] A preparar a configuracao...
if not exist .env (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\gerar-env.ps1" > "%TEMP%\oficinaos-env.txt"
    if errorlevel 1 (
        echo  ERRO: nao consegui gerar o ficheiro .env
        pause
        exit /b 1
    )
    set "INSTALOU_AGORA=1"
    echo        Ficheiro .env criado com segredos novos.
) else (
    echo        Ficheiro .env ja existe — mantido.
)

REM ── 3. Arrancar: imagem pronta (rapido) ou build local (fallback) ──────
echo [3/4] A instalar o OficinaOS...
set "COMPOSE_FILE=docker-compose.app.yml"
docker compose -f docker-compose.app.yml pull >nul 2>&1
if errorlevel 1 (
    set "COMPOSE_FILE=docker-compose.yml"
    echo        Imagem indisponivel — a construir localmente (~5 min)...
    docker compose up -d --build
) else (
    echo        Imagem pronta descarregada. A arrancar...
    docker compose -f docker-compose.app.yml up -d
)
if errorlevel 1 (
    echo.
    echo  ERRO: a instalacao falhou. Corre "docker compose logs" para ver o erro.
    pause
    exit /b 1
)

REM ── 4. Utilizador admin + dados iniciais (seed e idempotente) ──────────
echo [4/4] A preparar a base de dados...
timeout /t 8 /nobreak >nul
docker compose -f %COMPOSE_FILE% exec -T app bun run db:seed >nul 2>&1

REM ── Fim ────────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo    Instalacao concluida!
echo  ============================================
if exist PRIMEIRO-LOGIN.txt (
    type PRIMEIRO-LOGIN.txt
) else (
    echo   Abre http://localhost:4000 no browser.
)
echo.
echo  Para uso diario: duplo clique em INICIAR.bat
echo.
start "" "http://localhost:4000"
pause
