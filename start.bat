@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   VIBECOMIX - запуск редактора
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите актуальную LTS-версию Node.js и перезапустите это окно.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm не найден. Переустановите Node.js LTS и перезапустите это окно.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Первый запуск: устанавливаю зависимости проекта...
  call npm ci
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверьте подключение к интернету и повторите попытку.
    pause
    exit /b 1
  )
)

echo Запускаю VIBECOMIX. Не закрывайте это окно во время работы редактора.
echo В браузере откройте http://localhost:3000
call npm run dev

if errorlevel 1 (
  echo Сервер разработки завершился с ошибкой.
  pause
)

endlocal
