@echo off
REM Backup manual da base de dados (corre sozinho a cada arranque tambem)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BACKUP.ps1"
pause
