@echo off
REM run-app.bat — respawn wrapper: se a app crashar, reinicia passados 5s.
REM Sai apenas quando o ficheiro STOP existe (criado pelo PARAR.bat).
cd /d "%~dp0app"
del "%~dp0STOP" >nul 2>&1
:loop
if exist "%~dp0STOP" exit /b 0
"%~dp0bun\bun.exe" run start:prod
echo  [%date% %time%] A app parou inesperadamente — a reiniciar em 5s...
ping -n 6 127.0.0.1 >nul
goto loop
