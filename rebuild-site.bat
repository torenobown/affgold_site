@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovite Node.js i povtorite zapusk.
  pause
  exit /b 1
)
echo Obnovlenie SEO-stranic i sitemap...
node scripts\build-seo.mjs
if errorlevel 1 (
  echo Proizoshla oshibka. Proverte fail bazy.
  pause
  exit /b 1
)
echo Gotovo. Stranicy i sitemap obnovleny.
pause
