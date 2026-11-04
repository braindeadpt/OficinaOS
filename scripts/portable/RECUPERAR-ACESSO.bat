@echo off
REM RECUPERAR-ACESSO.bat — reposicao local de password (contas OWNER).
REM Pede administrador: a elevacao e a prova de acesso fisico ao servidor.
REM A password temporaria aparece UMA vez nesta consola — nao fica em
REM ficheiro nem log — e tem de ser mudada no primeiro login.
title OficinaOS — Recuperar acesso
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb runAs"
    exit /b 0
)

if exist "%~dp0app\.env" findstr /i /r /c:"^ *DEMO_MODE *= *true" "%~dp0app\.env" >nul && (
    echo  Recuperacao de acesso desativada em modo demo.
    pause
    exit /b 1
)

echo.
echo  OficinaOS — Recuperar acesso
echo  ============================
echo.
"%~dp0bun\bun.exe" run --cwd "%~dp0app" recover-access
if errorlevel 1 goto fim

echo.
set /p OF_USER=Utilizador a repor (vazio cancela):
if "%OF_USER%"=="" goto fim
echo.
"%~dp0bun\bun.exe" run --cwd "%~dp0app" recover-access -- --user "%OF_USER%"

:fim
echo.
pause
