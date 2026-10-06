@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS - Atualizar (portatil)
cd /d "%~dp0"

echo  A descarregar a versao mais recente...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip' -OutFile \"$env:TEMP\oficinaos-portable-update.zip\""
if errorlevel 1 (
    echo  ERRO: download falhou. Sem alteracoes feitas.
    pause
    exit /b 1
)

echo  A parar o OficinaOS...
call "%~dp0PARAR.bat"

echo  A fazer backup da configuracao...
if exist "%~dp0app\.env" copy /y "%~dp0app\.env" "%TEMP%\oficinaos-env.bak" >nul

echo  A extrair a nova versao...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath \"$env:TEMP\oficinaos-portable-update.zip\" -DestinationPath \"$env:TEMP\oficinaos-portable-update\""
if errorlevel 1 (
    echo  ERRO: extracao falhou. A instalacao anterior esta intacta.
    pause
    exit /b 1
)

REM Copia tudo por cima EXCETO a base de dados (data\) e a configuracao (.env)
if not exist "%TEMP%\oficinaos-portable-update\oficinaos-portable" (
    echo  ERRO: o pacote extraido nao tem o conteudo esperado — nada foi alterado.
    pause
    exit /b 1
)
robocopy "%TEMP%\oficinaos-portable-update\oficinaos-portable" "%~dp0" /E /XD data /XF .env PRIMEIRO-LOGIN.txt /NFL /NDL /NJH >nul
REM robocopy: 0-7 = sucesso (copiado/identico/extra), >=8 = falhou a copia.
if errorlevel 8 (
    echo  ERRO: a copia falhou (robocopy %errorlevel%). A instalacao pode estar incompleta —
    echo  repete o ATUALIZAR.bat; se persistir, restaura o backup manualmente.
    pause
    exit /b 1
)
if exist "%TEMP%\oficinaos-env.bak" copy /y "%TEMP%\oficinaos-env.bak" "%~dp0app\.env" >nul

rmdir /s /q "%TEMP%\oficinaos-portable-update" >nul 2>&1
del "%TEMP%\oficinaos-portable-update.zip" >nul 2>&1
del "%TEMP%\oficinaos-env.bak" >nul 2>&1

echo  A iniciar a versao nova (migracoes correm automaticamente)...
call "%~dp0INICIAR.bat"
