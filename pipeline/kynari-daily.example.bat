@echo off
REM Plantilla del lanzador diario. Copiala como kynari-daily.bat y rellena las claves.
REM Los .bat con claves reales NO se suben al repo (.gitignore).
set ANTHROPIC_API_KEY=
set FAL_API_KEY=
set GHOST_ADMIN_KEY=
set TMDB_API_KEY=
set IGDB_CLIENT_ID=
set IGDB_CLIENT_SECRET=
cd /d "%~dp0"
node kynari-publisher.mjs daily
echo.
echo ================================
echo Terminado. Cierra esta ventana o pulsa una tecla.
pause >nul
