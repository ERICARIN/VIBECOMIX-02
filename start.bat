@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if errorlevel 1 (
  echo Could not open the project folder.
  echo Move or extract the project to a simple path such as C:\VIBECOMIX and try again.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not available in PATH.
  echo Install the current Node.js LTS version, then reopen this file.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS and try again.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing project dependencies. This only happens on the first launch.
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting VIBECOMIX. Keep this window open while using the editor.
echo The browser will open automatically at http://localhost:3000.
call npm run dev -- --open

if errorlevel 1 (
  echo The development server stopped with an error.
  pause
)

endlocal
