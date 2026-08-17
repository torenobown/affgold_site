@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovite Node.js i povtorite zapusk.
  pause
  exit /b 1
)

echo Zapusk lokalnogo redaktora AFFGOLD...
node scripts\admin-server.mjs --open

if errorlevel 1 (
  echo Ne udalos zapustit redaktor.
  pause
  exit /b 1
)
