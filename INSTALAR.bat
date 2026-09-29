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

REM ── 0. Ja esta instalado e a correr? ───────────────────────────────────
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 (
    echo  O OficinaOS ja esta a correr neste PC.
    echo  Abre http://localhost:4000 no browser.
    echo.
    start "" "http://localhost:4000"
    pause
    exit /b 0
)

REM ── 1. Docker Desktop ──────────────────────────────────────────────────
echo [1/4] A verificar o Docker...
REM Docker pode estar instalado mas fora do PATH desta sessao
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"

docker info >nul 2>&1
if not errorlevel 1 goto docker_ok

where docker >nul 2>&1
if not errorlevel 1 goto docker_arrancar

REM Docker nao esta instalado — tentar instalar via winget
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
echo        Docker Desktop nao encontrado. A instalar ^(pode demorar^)...
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo  ERRO: nao consegui instalar o Docker automaticamente.
    echo  Instala manualmente em https://www.docker.com/products/docker-desktop/
    echo  e volta a correr este ficheiro.
    pause
    exit /b 1
)
echo        Docker Desktop instalado.
set "DOCKER_RECEM_INSTALADO=1"

:docker_arrancar
echo        A iniciar o Docker Desktop ^(primeira vez pode demorar^)...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
set /a TENT=0
:esperar_docker
timeout /t 5 /nobreak >nul
set /a TENT+=1
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
if !TENT! LSS 48 goto esperar_docker
echo.
if defined DOCKER_RECEM_INSTALADO (
    echo  O Docker acabou de ser instalado e precisa de um reinicio.
    echo  REINICIA o PC e volta a correr o INSTALAR.bat — a instalacao
    echo  continua a partir deste ponto.
) else (
    echo  ERRO: o Docker Desktop nao respondeu.
    echo  Abre o Docker Desktop manualmente, espera que arranque
    echo  ^(icone da baleia no tabuleiro fica parado^), e repete a instalacao.
)
pause
exit /b 1

:docker_ok
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
    echo        Ficheiro .env criado com segredos novos.
) else (
    echo        Ficheiro .env ja existe — mantido.
)

REM ── 3. Descarregar imagem e arrancar ───────────────────────────────────
echo [3/4] A instalar o OficinaOS ^(a 1a vez descarrega ~1GB, pode demorar^)...
set "COMPOSE_FILE=docker-compose.app.yml"
docker compose -f docker-compose.app.yml pull
if errorlevel 1 (
    set "COMPOSE_FILE=docker-compose.yml"
    echo        Imagem indisponivel — a construir localmente ^(~5 min^)...
    docker compose up -d --build
) else (
    docker compose -f docker-compose.app.yml up -d
)
if errorlevel 1 (
    echo.
    echo  ERRO: a instalacao falhou.
    echo  Corre "docker compose logs --tail 30" para ver o erro.
    echo  Se a porta 4000 estiver ocupada por outro programa, liberta-a
    echo  e repete a instalacao.
    pause
    exit /b 1
)

REM ── Esperar que a app responda (migrations + primeiro arranque) ────────
echo        A aguardar que a aplicacao arranque...
set /a TENT=0
:esperar_app
timeout /t 5 /nobreak >nul
set /a TENT+=1
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 goto app_pronta
if !TENT! LSS 36 goto esperar_app
echo.
echo  AVISO: a app nao respondeu em 3 minutos.
echo  Corre "docker compose logs app" para ver o que aconteceu.
echo  A base de dados pode ainda estar a inicializar — espera 1-2 min
echo  e abre http://localhost:4000 no browser.
pause
exit /b 1
:app_pronta

REM ── 4. Utilizador admin + dados iniciais (seed e idempotente) ──────────
echo [4/4] A criar o utilizador inicial...
docker compose -f %COMPOSE_FILE% exec -T app bun run db:seed
if errorlevel 1 (
    timeout /t 10 /nobreak >nul
    docker compose -f %COMPOSE_FILE% exec -T app bun run db:seed
)
if errorlevel 1 (
    echo.
    echo  AVISO: a criacao do utilizador falhou.
    echo  Tenta mais tarde com:
    echo    docker compose -f %COMPOSE_FILE% exec app bun run db:seed
)

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
