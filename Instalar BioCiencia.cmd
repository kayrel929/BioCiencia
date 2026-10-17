@echo off
REM ============================================================
REM  Instalador de BioCiencia
REM  Verifica Node.js, instala dependencias, compila y crea
REM  accesos directos en el escritorio y menu de inicio.
REM ============================================================
chcp 65001 >nul
title Instalador de BioCiencia
cd /d "%~dp0"

echo.
echo ============================================================
echo   Instalador de BioCiencia
echo ============================================================
echo.

REM --- 1. Verificar Node.js ---
echo [1/5] Verificando Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: No se encontro Node.js.
    echo.
    echo   BioCiencia necesita Node.js 22 o mas reciente.
    echo   Descarguelo desde: https://nodejs.org
    echo.
    echo   Despues de instalar Node.js, vuelva a ejecutar
    echo   este instalador.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo   Node.js %NODE_VERSION% encontrado.

REM --- 2. Verificar npm ---
echo.
echo [2/5] Verificando npm...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: No se encontro npm.
    echo   npm viene con Node.js. Reinstale Node.js.
    echo.
    pause
    exit /b 1
)
echo   npm encontrado.

REM --- 3. Instalar dependencias ---
echo.
echo [3/5] Instalando dependencias...
echo   (Esto puede tardar unos minutos la primera vez)
echo.
call npm.cmd install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: No se pudieron instalar las dependencias.
    echo   Revise su conexion a internet e intente de nuevo.
    echo.
    pause
    exit /b 1
)
echo.
echo   Dependencias instaladas correctamente.

REM --- 4. Compilar la aplicacion ---
echo.
echo [4/5] Compilando BioCiencia...
echo.
call npm.cmd run build:web
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: No se pudo compilar la aplicacion.
    echo.
    pause
    exit /b 1
)
echo.
echo   Aplicacion compilada correctamente.

REM --- 5. Crear accesos directos ---
echo.
echo [5/5] Creando accesos directos...
echo.

REM Acceso directo en el escritorio
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\BioCiencia.lnk"
set "TARGET=%~dp0Iniciar BioCiencia.cmd"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0apps\web\favicon.ico'; $s.Description = 'BioCiencia - Investigacion cientifica'; $s.Save()" 2>nul

if exist "%SHORTCUT%" (
    echo   Acceso directo en el escritorio creado.
) else (
    echo   No se pudo crear el acceso directo en el escritorio.
    echo   (Puede crear uno manualmente desde "Iniciar BioCiencia.cmd")
)

REM Acceso directo en el menu de inicio
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\BioCiencia"
if not exist "%STARTMENU%" mkdir "%STARTMENU%"
set "SHORTCUT2=%STARTMENU%\BioCiencia.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT2%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0apps\web\favicon.ico'; $s.Description = 'BioCiencia - Investigacion cientifica'; $s.Save()" 2>nul

if exist "%SHORTCUT2%" (
    echo   Acceso directo en el menu de inicio creado.
) else (
    echo   No se pudo crear el acceso directo en el menu de inicio.
)

REM --- Fin ---
echo.
echo ============================================================
echo   Instalacion completada
echo ============================================================
echo.
echo   BioCiencia esta listo para usar.
echo.
echo   Para abrir el programa:
echo     - Doble clic en "BioCiencia" del escritorio, o
echo     - Busque "BioCiencia" en el menu de inicio, o
echo     - Ejecute "Iniciar BioCiencia.cmd"
echo.
echo   La primera vez que lo abra, tardara unos segundos
echo   en cargar. Despues sera instantaneo.
echo.
echo ============================================================
echo.

REM Preguntar si quiere abrir BioCiencia ahora
choice /c SN /m "Desea abrir BioCiencia ahora"
if %errorlevel% equ 1 (
    start "" "%~dp0Iniciar BioCiencia.cmd"
)

exit /b 0
