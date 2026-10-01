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

REM Sem Docker funcional — verificar virtualizacao antes de instalar Docker.
REM (0 = OK, 1 = desativada na BIOS, 2 = CPU sem suporte)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-virtualization.ps1"
if errorlevel 2 goto sem_suporte_cpu
if errorlevel 1 goto menu_sem_virtualizacao

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
ping -n 6 127.0.0.1 >nul
set /a TENT+=1
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
if !TENT! LSS 48 goto esperar_docker
REM Docker nao respondeu — pode ser virtualizacao desligada
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-virtualization.ps1"
if errorlevel 2 goto sem_suporte_cpu
if errorlevel 1 goto menu_sem_virtualizacao
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
ping -n 6 127.0.0.1 >nul
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
    ping -n 11 127.0.0.1 >nul
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
exit /b 0

REM ── CPU sem suporte a virtualizacao — portatil e a unica opcao ────────
:sem_suporte_cpu
echo.
echo  ============================================
echo   ATENCAO: este PC nao suporta virtualizacao
echo  ============================================
echo.
echo  O processador nao tem Intel VT-x / AMD-V, por isso
echo  o Docker Desktop nunca vai funcionar aqui.
echo  A instalacao portatil nao precisa de Docker.
echo.
pause
goto portable

REM ── Virtualizacao desativada: escolher BIOS ou instalacao portatil ────
:menu_sem_virtualizacao
echo.
echo  ============================================
echo   ATENCAO: virtualizacao desativada na BIOS
echo  ============================================
echo.
echo  O Docker Desktop precisa de virtualizacao de
echo  hardware (Intel VT-x / AMD SVM) — neste PC esta
echo  desativada, por isso o Docker nao vai funcionar.
echo.
echo   [1] Ativar na BIOS e voltar a correr o instalador
echo   [2] Instalacao PORTATIL — sem Docker (recomendado)
echo.
echo  Guia BIOS ^(opcao 1^): reinicia o PC e prime
echo  F2, F10, DEL ou ESC no arranque. Procura
echo  "Intel Virtualization Technology", "VT-x" ou
echo  "SVM Mode" em Advanced / Security / CPU
echo  Configuration, ativa e grava com F10.
echo.
choice /c 12 /n /m "Escolhe 1 ou 2: "
if errorlevel 2 goto portable
echo.
echo  Reinicia o PC, ativa a virtualizacao na BIOS e
echo  volta a correr o INSTALAR.bat.
pause
exit /b 0

REM ── Instalacao portatil: download do bundle pre-empacotado ────────────
:portable
echo.
echo  [P] Instalacao portatil — sem Docker.
if exist "%~dp0oficinaos-portable\INICIAR.bat" (
    echo        Instalacao portatil ja existe — a iniciar.
    call "%~dp0oficinaos-portable\INICIAR.bat"
    exit /b 0
)
echo        A descarregar o pacote portatil ^(~400MB^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip' -OutFile \"$env:TEMP\oficinaos-portable.zip\""
if errorlevel 1 (
    echo.
    echo  ERRO: nao consegui descarregar o pacote portatil.
    echo  Verifica a ligacao a internet e repete.
    pause
    exit /b 1
)
echo        A extrair...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath \"$env:TEMP\oficinaos-portable.zip\" -DestinationPath \"%~dp0\""
if errorlevel 1 (
    echo.
    echo  ERRO: nao consegui extrair o pacote.
    pause
    exit /b 1
)
del "%TEMP%\oficinaos-portable.zip" >nul 2>&1
call "%~dp0oficinaos-portable\INICIAR.bat"
exit /b 0
