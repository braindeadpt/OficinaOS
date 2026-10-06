@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS - Atualizar
cd /d "%~dp0"

echo.
echo  ============================================
echo    OficinaOS - Atualizacao
echo    Gestao de reparacao de telemoveis
echo  ============================================
echo.

REM ── 1. Docker a correr ─────────────────────────────────────────────
echo [1/4] A verificar o Docker...
REM Docker pode estar instalado mas fora do PATH desta sessao
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"

docker info >nul 2>&1
if not errorlevel 1 goto docker_ok

where docker >nul 2>&1
if errorlevel 1 (
    echo  ERRO: Docker Desktop nao esta instalado.
    echo  Corre primeiro o INSTALAR.bat
    pause
    exit /b 1
)

echo        Docker parado — a iniciar o Docker Desktop...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
set /a TENT=0
:esperar_docker
ping -n 6 127.0.0.1 >nul
set /a TENT+=1
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
if !TENT! LSS 48 goto esperar_docker
echo.
echo  ERRO: o Docker Desktop nao respondeu.
echo  Abre-o manualmente, espera que arranque e volta a correr este ficheiro.
pause
exit /b 1

:docker_ok
echo        Docker OK.

REM ── 2. Backup antes de mexer ───────────────────────────────────────
echo [2/4] A fazer backup da base de dados...
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if errorlevel 1 goto backup_salto
REM Reutiliza o script do contentor de backups diarios — grava no volume
REM "backups" junto dos dumps automaticos.
docker compose -f docker-compose.app.yml exec -T db-backup bash /scripts/run-backup.sh >nul 2>&1
if not errorlevel 1 goto backup_feito
echo        AVISO: o backup falhou. Existem backups diarios automaticos,
echo        mas se quiseres cancelar fecha esta janela agora.
pause
goto backup_feito
:backup_salto
echo        A app esta parada — os dados ficam nos volumes do Docker.
:backup_feito

REM ── 3. Descarregar a nova versao ───────────────────────────────────
echo [3/4] A descarregar a versao mais recente...
REM Instalacao em modo build? Atualiza o source e reconstroi.
if exist "%~dp0oficinaos-src\app-source\docker-compose.yml" goto atualizar_source
docker compose -f docker-compose.app.yml pull
if errorlevel 1 (
    docker compose pull
    if errorlevel 1 (
        echo.
        echo  ERRO: nao consegui descarregar a imagem.
        echo  Verifica a ligacao a internet e repete.
        pause
        exit /b 1
    )
)
goto reiniciar

:atualizar_source
echo        Instalacao em modo build — a descarregar o codigo novo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/braindeadpt/OficinaOS/archive/refs/heads/main.zip' -OutFile \"$env:TEMP\oficinaos-src.zip\"; Expand-Archive -Force -LiteralPath \"$env:TEMP\oficinaos-src.zip\" -DestinationPath \"$env:TEMP\oficinaos-src\""
if errorlevel 1 (
    echo.
    echo  ERRO: nao consegui descarregar o codigo.
    echo  Verifica a ligacao a internet e repete.
    pause
    exit /b 1
)
xcopy /E /I /Y /Q "%TEMP%\oficinaos-src\OficinaOS-main" "%~dp0oficinaos-src\app-source" >nul
rmdir /s /q "%TEMP%\oficinaos-src" "%TEMP%\oficinaos-src.zip" >nul 2>&1
REM O .env do build vive na pasta do source — preserva o existente.
if exist "%~dp0.env" copy /y "%~dp0.env" "%~dp0oficinaos-src\app-source\.env" >nul 2>&1
goto reiniciar

:reiniciar
REM ── 4. Reiniciar — as migracoes da base de dados correm sozinhas ───
echo [4/4] A reiniciar o OficinaOS...
if exist "%~dp0oficinaos-src\app-source\docker-compose.yml" (
    docker compose -f "%~dp0oficinaos-src\app-source\docker-compose.yml" up -d --build
    goto build_feito
)
docker compose -f docker-compose.app.yml up -d 2>nul
if errorlevel 1 docker compose up -d
:build_feito
if errorlevel 1 (
    echo.
    echo  ERRO: a app nao arrancou.
    echo  Corre "docker compose logs --tail 30 app" para ver o erro.
    pause
    exit /b 1
)

REM Esperar que a app responda — migracoes podem demorar
echo        A aguardar que a app arranque e atualize a base de dados...
set /a TENT=0
:esperar_app
ping -n 6 127.0.0.1 >nul
set /a TENT+=1
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 goto pronto
if !TENT! LSS 36 goto esperar_app
echo.
echo  AVISO: a app ainda nao respondeu — a atualizacao da base de dados
echo  pode estar em curso. Espera 1-2 minutos e abre http://localhost:4000
pause
exit /b 1

:pronto
echo.
echo  ============================================
echo    Atualizacao concluida!
echo  ============================================
echo.
start "" "http://localhost:4000"
pause
