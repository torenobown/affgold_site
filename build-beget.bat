@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovite Node.js i povtorite zapusk.
  pause
  exit /b 1
)

echo [1/5] Sborka saita dlya affgoldprod.com...
set "AFFGOLD_SITE_URL=https://affgoldprod.com"
node scripts\build-seo.mjs
if errorlevel 1 goto :error

echo [2/5] Proverka saita...
node scripts\check-site.mjs
if errorlevel 1 goto :error

echo [3/5] Podgotovka publichnogo kataloga dlya Beget...
node scripts\build-beget.mjs
if errorlevel 1 goto :error

echo [4/5] Sozdanie proverennogo ZIP s POSIX-putyami...
node scripts\create-release-zip.mjs
if errorlevel 1 goto :error

echo [5/5] Finalnaya proverka release-komplekta...
node scripts\check-release.mjs
if errorlevel 1 goto :error

echo.
echo Gotovo: affgold-beget.zip
echo Zagruzite ZIP v KORNEVUYU PAPKU domena na Beget i izvlekite ego s zamenoi failov.
echo Posle raspakovki ryadom dolzhny lezhat .htaccess, index.html, css, assets, js i reviews.
pause
exit /b 0

:error
echo.
echo Sborka ostanovlena iz-za oshibki. Na hosting nichego zagruzhat ne nuzhno.
pause
exit /b 1
