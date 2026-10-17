@echo off
REM Abre BioCiencia como aplicacion en esta computadora (doble clic).
REM La primera vez tarda unos minutos (instala y prepara la version compilada).
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instalelo desde https://nodejs.org ^(version 22 o mas reciente^). & pause & exit /b 1)
REM Siempre: enlaza las partes nuevas tras una actualizacion (rapido si ya esta todo)
echo Revisando la instalacion...
call npm.cmd install --no-audit --no-fund >nul || (echo No se pudo instalar. Revise su conexion a internet. & pause & exit /b 1)
echo Preparando BioCiencia...
call npm.cmd run build:web >nul || (echo No se pudo compilar. & pause & exit /b 1)
REM Abre el navegador 2 segundos despues, cuando el servidor ya esta listo
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:5173/"
node scripts\servir.mjs
pause