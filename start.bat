@echo off
chcp 65001 >nul
title SATOSHI - DIGITAL GOLD
cd /d "%~dp0"
echo ========================================
echo       SATOSHI: DIGITAL GOLD
echo ========================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установи LTS-версию с https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Устанавливаю зависимости при первом запуске...
  call npm install
  if errorlevel 1 (echo Не удалось установить зависимости.& pause & exit /b 1)
)
if not exist .env copy .env.example .env >nul
echo.
echo Сервер запускается. Не закрывай это окно.
echo Когда сервер запустится, открой http://localhost:3000
echo.
call npm start
pause
