@echo off
REM run-app.bat — respawn wrapper: se a app crashar, reinicia passados 5s.
REM Sai apenas quando o ficheiro STOP existe (criado pelo PARAR.bat).
REM O titulo nao pode ficar vazio: o bun/libuv rebenta com
REM "Assertion failed: process_title" numa consola sem titulo.
title OficinaOS
REM cwd na raiz, NAO em app\ — um cmd com cwd dentro de app\ mantem a pasta
REM ocupada e o Rename-Item do update-apply.ps1 falhava ("being used").
cd /d "%~dp0"
del "%~dp0STOP" >nul 2>&1
:loop
if exist "%~dp0STOP" exit /b 0
"%~dp0bun\bun.exe" --cwd "%~dp0app" run start:prod
echo  [%date% %time%] A app parou inesperadamente — a reiniciar em 5s...
ping -n 6 127.0.0.1 >nul
goto loop
