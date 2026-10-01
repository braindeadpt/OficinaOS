@echo off
chcp 65001 >nul
title OficinaOS - Restaurar backup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RESTORE.ps1"
pause
