@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title OficinaOS - Atualizar (portatil)
cd /d "%~dp0"

set "ZIP=%TEMP%\oficinaos-portable-update.zip"
set "SHA=%TEMP%\oficinaos-portable-update.zip.sha256"
set "STAGE=%TEMP%\oficinaos-portable-update"

REM Limpar staging antigo antes de qualquer extracao: ficheiros de uma
REM tentativa anterior nunca podem misturar-se com o pacote novo.
if exist "%STAGE%" rmdir /s /q "%STAGE%" >nul 2>&1
del "%ZIP%" >nul 2>&1
del "%SHA%" >nul 2>&1

echo  A descarregar a versao mais recente e a soma SHA256 publicada...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip' -OutFile \"$env:TEMP\oficinaos-portable-update.zip\""
if errorlevel 1 goto download_error
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip.sha256' -OutFile \"$env:TEMP\oficinaos-portable-update.zip.sha256\""
if errorlevel 1 goto download_error

echo  A verificar a integridade do pacote antes de o extrair...
for /f "tokens=1" %%H in ('type "%SHA%"') do set "EXPECTED=%%H"
for /f %%H in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath \"$env:TEMP\oficinaos-portable-update.zip\").Hash.ToLower()"') do set "ACTUAL=%%H"
if not defined EXPECTED goto hash_error
if not defined ACTUAL goto hash_error
if /i not "%EXPECTED%"=="%ACTUAL%" goto hash_error

echo  A parar o OficinaOS...
call "%~dp0PARAR.bat"

echo  A fazer backup da configuracao...
if exist "%~dp0app\.env" copy /y "%~dp0app\.env" "%TEMP%\oficinaos-env.bak" >nul

echo  A extrair a nova versao...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath \"$env:TEMP\oficinaos-portable-update.zip\" -DestinationPath \"$env:TEMP\oficinaos-portable-update\""
if errorlevel 1 goto extract_error

REM Copia tudo por cima EXCETO a base de dados (data\) e a configuracao (.env).
REM Nao usar /MIR: mirror apaga ficheiros ausentes do pacote e a raiz portatil
REM contem dados, uploads e configuracao do utilizador; sem um manifesto completo
REM de preservacao isso podia destruir a instalacao. As exclusoes explicitas sao
REM a alternativa segura.
if not exist "%STAGE%\oficinaos-portable" goto package_error
robocopy "%STAGE%\oficinaos-portable" "%~dp0" /E /XD data /XF .env PRIMEIRO-LOGIN.txt /NFL /NDL /NJH >nul
REM robocopy: 0-7 = sucesso (copiado/identico/extra), >=8 = falhou a copia.
if errorlevel 8 goto copy_error
if exist "%TEMP%\oficinaos-env.bak" copy /y "%TEMP%\oficinaos-env.bak" "%~dp0app\.env" >nul

:cleanup
rmdir /s /q "%STAGE%" >nul 2>&1
del "%ZIP%" >nul 2>&1
del "%SHA%" >nul 2>&1
del "%TEMP%\oficinaos-env.bak" >nul 2>&1

echo  A iniciar a versao nova (migracoes correm automaticamente)...
call "%~dp0INICIAR.bat"
exit /b 0

:download_error
echo  ERRO: download falhou. Sem alteracoes feitas.
goto fail

:hash_error
echo  ERRO: a soma SHA256 nao confere. O pacote nao foi extraido nem instalado.
goto fail

:extract_error
echo  ERRO: extracao falhou. A instalacao anterior esta intacta.
goto fail

:package_error
echo  ERRO: o pacote extraido nao tem o conteudo esperado - nada foi alterado.
goto fail

:copy_error
echo  ERRO: a copia falhou (robocopy %errorlevel%). A instalacao pode estar incompleta -
echo  repete o ATUALIZAR.bat; se persistir, restaura o backup manualmente.
goto fail

:fail
rmdir /s /q "%STAGE%" >nul 2>&1
del "%ZIP%" >nul 2>&1
del "%SHA%" >nul 2>&1
del "%TEMP%\oficinaos-env.bak" >nul 2>&1
pause
exit /b 1
