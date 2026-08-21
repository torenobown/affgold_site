@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovite Node.js i povtorite zapusk.
  pause
  exit /b 1
)

echo [1/4] Sborka saita dlya affgoldprod.com...
set "AFFGOLD_SITE_URL=https://affgoldprod.com"
node scripts\build-seo.mjs
if errorlevel 1 goto :error

echo [2/4] Proverka saita...
node scripts\check-site.mjs
if errorlevel 1 goto :error

echo [3/4] Podgotovka polnogo kataloga dlya Beget...
node scripts\build-beget.mjs
if errorlevel 1 goto :error

echo [4/4] Sozdanie ZIP...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$zip = Join-Path (Get-Location) 'affgold-beget.zip'; Compress-Archive -Path (Join-Path (Get-Location) 'beget-upload\*') -DestinationPath $zip -CompressionLevel Optimal -Force"
if errorlevel 1 goto :error

echo.
echo Gotovo: affgold-beget.zip
echo Zagruzite ZIP v KORNEVUYU PAPKU domena na Beget i izvlekite ego s zamenoi failov.
echo Posle raspakovki ryadom dolzhny lezhat index.html, css, assets, js i reviews.
pause
exit /b 0

:error
echo.
echo Sborka ostanovlena iz-za oshibki. Na hosting nichego zagruzhat ne nuzhno.
pause
exit /b 1
