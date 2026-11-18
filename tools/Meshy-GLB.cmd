@echo off
REM Windows: двойной клик. Нужен Node.js >= 18 (https://nodejs.org).
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Поставь с https://nodejs.org - нужна версия 18 или новее.
  pause
  exit /b 1
)
node tools\meshy-get.mjs %*
if errorlevel 1 pause
