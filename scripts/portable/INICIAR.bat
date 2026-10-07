@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS - Portatil
cd /d "%~dp0"

set "PGDATA=%~dp0data"
set "PGBIN=%~dp0pgsql\bin"
set "BUN=%~dp0bun\bun.exe"

REM ── app ja a correr? ─────────────────────────────────────────────────
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 (
    echo  O OficinaOS ja esta a correr. A abrir o browser...
    start "" "http://localhost:4000"
    exit /b 0
)

REM ── .env na primeira execucao ────────────────────────────────────────
if not exist "%~dp0app\.env" (
    echo  A gerar configuracao inicial...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gerar-env.ps1"
    if errorlevel 1 (
        echo  ERRO: nao consegui gerar app\.env
        pause
        exit /b 1
    )
)
REM ── Postgres portatil: initdb na 1a vez, depois start ────────────────
REM listen_addresses=127.0.0.1 + scram-sha-256: so quem tem a password do
REM .env/.pgpass liga — nem outros processos deste PC. A app fica exposta
REM na LAN, a BD nao.
REM O initdb/postgres falham com acentos no caminho (Windows passa-o em
REM CP1252 e o backend le-o como UTF-8). Usar sempre o nome curto 8.3 —
REM e ASCII puro e aponta para a mesma pasta.
if not exist "%PGDATA%" mkdir "%PGDATA%"
for %%I in ("%PGDATA%") do set "PGDATA=%%~sI"
if not exist "%PGDATA%\PG_VERSION" (
    echo  A inicializar a base de dados ^(primeira vez^)...
    REM dir existe mas sem PG_VERSION = initdb falhou a meio — limpar e refazer
    rmdir /s /q "%PGDATA%"
    mkdir "%PGDATA%"
    REM o log tem de ficar FORA de data\ — initdb exige a pasta vazia
    "%PGBIN%\initdb.exe" -D "%PGDATA%" -U postgres -E UTF8 --locale=C --auth=scram-sha-256 --pwfile="%~dp0app\.pgpass" >"%~dp0initdb.log" 2>&1
    if not exist "%PGDATA%\PG_VERSION" (
        echo  ERRO: a inicializacao da base de dados falhou. Ve initdb.log
        echo  DICA: se a pasta tiver acentos, extrai para C:\OficinaOS e tenta de novo.
        type "%~dp0initdb.log"
        pause
        exit /b 1
    )
    echo        listen_addresses = '127.0.0.1'>>"%PGDATA%\postgresql.conf"
    echo        port = 5433>>"%PGDATA%\postgresql.conf"
)

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
if errorlevel 1 (
    "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\postgres.log" -w start >nul 2>&1
    if errorlevel 1 (
        echo  ERRO: o Postgres nao arrancou. Ve data\postgres.log
        pause
        exit /b 1
    )
)

REM Clusters pre-v1.0.12 tinham auth=trust — migrar para scram (o postgres
REM ja esta a correr neste ponto, que e o que o harden-pg.ps1 precisa).
if exist "%PGDATA%\PG_VERSION" if not exist "%~dp0app\.pgpass" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0harden-pg.ps1"
)
REM password do postgres para o psql/createdb abaixo (novas ou migradas)
if exist "%~dp0app\.pgpass" set /p PGPASSWORD=<"%~dp0app\.pgpass"

REM -w: nunca pedir password interactivamente — sem .pgpass falha rapido
REM em vez de pendurar a consola a espera de input.
"%PGBIN%\psql.exe" -w -h 127.0.0.1 -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='oficinaos'" 2>nul | findstr /b "1" >nul
if errorlevel 1 (
    "%PGBIN%\createdb.exe" -w -h 127.0.0.1 -p 5433 -U postgres oficinaos >nul 2>&1
)

REM ── backup diario (equivalente ao sidecar db-backup do Docker) ───────
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BACKUP.ps1" >nul 2>&1

REM ── auto-arranque com o PC: pergunta uma vez, resposta fica em data\ ──
if exist "%PGDATA%\PG_VERSION" if not exist "%PGDATA%\autostart.flag" (
    REM Em CI (GitHub Actions) nao ha consola para o `choice` — assume N.
    if defined CI (
        echo n>"%PGDATA%\autostart.flag"
    ) else (
    echo.
    choice /c SN /n /m "Iniciar o OficinaOS automaticamente quando o PC liga? [S/N] "
    if errorlevel 2 (
        echo n>"%PGDATA%\autostart.flag"
    ) else (
        call :registar_arranque
        if errorlevel 1 (
            echo        AVISO: nao consegui registar o arranque automatico.
        ) else (
            echo s>"%PGDATA%\autostart.flag"
            echo        OK — arranca sozinho a partir do proximo arranque.
        )
    )
    )
)

REM ── migracoes + arranque com respawn (start:prod = migrate + serve) ──
cd /d "%~dp0app"
echo  A aplicar migracoes e a arrancar...
start "OficinaOS" /min cmd /c "%~dp0run-app.bat"

REM ── esperar a app e semear o admin ───────────────────────────────────
set /a TENT=0
:esperar_app
ping -n 6 127.0.0.1 >nul
set /a TENT+=1
curl -sf --max-time 3 http://localhost:4000/health >nul 2>&1
if not errorlevel 1 goto app_pronta
if !TENT! LSS 36 goto esperar_app
echo  AVISO: a app nao respondeu em 3 minutos. Ve a janela minimizada.
pause
exit /b 1

:app_pronta
"%BUN%" run db:seed >nul 2>&1
echo.
echo  ============================================
echo    OficinaOS a correr!
echo  ============================================
if exist "%~dp0PRIMEIRO-LOGIN.txt" type "%~dp0PRIMEIRO-LOGIN.txt"
start "" "http://localhost:4000"
exit /b 0

:registar_arranque
REM Register-ScheduledTask em vez de schtasks /tr — o /tr "\"...\"" partia
REM as aspas em caminhos com espacos e a tarefa nunca era criada (o mesmo
REM bug do B13 no setup-service.ps1). Sem admin: tarefa do proprio user.
powershell -NoProfile -Command "$a = New-ScheduledTaskAction -Execute '%~dp0INICIAR.bat'; $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; Register-ScheduledTask -TaskName 'OficinaOS' -Action $a -Trigger $t -Force" >nul 2>&1
exit /b %errorlevel%
