; Instalador de BioCiencia para Windows (NSIS 3). Licencia MIT.
; Se instala para el usuario actual (no necesita permisos de administrador) en
;   %LOCALAPPDATA%\Programs\BioCiencia
; Construir:  makensis -DVERSION=1.2.0 -DSRC=<carpeta con BioCiencia.exe y app\> BioCiencia.nsi

Unicode true
; 64 bits, igual que BioCiencia.exe (Windows 10 y 11 de 64 bits)
Target amd64-unicode
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.2.0"
!endif
!ifndef SRC
  !define SRC "dist-instalador"
!endif
!ifndef OUT
  !define OUT "BioCiencia-${VERSION}-instalador.exe"
!endif

!define APP "BioCiencia"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BioCiencia"

Name "${APP} ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\BioCiencia"
InstallDirRegKey HKCU "Software\BioCiencia" "Carpeta"
BrandingText "BioCiencia ${VERSION} · software libre (MIT)"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1034 "ProductName" "BioCiencia"
VIAddVersionKey /LANG=1034 "FileDescription" "Instalador de BioCiencia"
VIAddVersionKey /LANG=1034 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1034 "LegalCopyright" "Licencia MIT"

!include "MUI2.nsh"
!define MUI_ICON "biociencia.ico"
!define MUI_UNICON "biociencia.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a BioCiencia ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Plataforma de investigación científica colaborativa.$\r$\n$\r$\nSe instalará solo para su usuario; no hace falta ser administrador. Sus datos (biblioteca, proyectos, PDF) se guardan en su computadora.$\r$\n$\r$\nSi tenía BioCiencia abierta con «Iniciar BioCiencia.cmd», cierre esa ventana negra antes de continuar."
!define MUI_FINISHPAGE_RUN "$INSTDIR\BioCiencia.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir BioCiencia ahora"
!define MUI_FINISHPAGE_TEXT "BioCiencia quedó instalada. Ábrala desde el escritorio o el menú Inicio.$\r$\n$\r$\nMientras esté abierta verá su ícono junto al reloj de Windows: clic para abrirla, clic derecho → Salir para cerrarla."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
  ; Si BioCiencia está abierta, se cierra para poder actualizar sus archivos
  nsExec::Exec 'taskkill /IM BioCiencia.exe /F'
  Pop $0
FunctionEnd

Section "BioCiencia" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; La versión nueva reemplaza la aplicación anterior (los datos del usuario no están aquí)
  RMDir /r "$INSTDIR\app"
  File "${SRC}\BioCiencia.exe"
  File "LICENSE.txt"
  File "TERCEROS.txt"
  File "LEAME.txt"
  File "biociencia.ico"
  SetOutPath "$INSTDIR\app"
  File /r "${SRC}\app\*.*"
  SetOutPath "$INSTDIR"

  CreateDirectory "$SMPROGRAMS\BioCiencia"
  CreateShortCut "$SMPROGRAMS\BioCiencia\BioCiencia.lnk" "$INSTDIR\BioCiencia.exe" "" "$INSTDIR\biociencia.ico" 0 SW_SHOWNORMAL "" "Plataforma de investigación científica colaborativa"
  CreateShortCut "$SMPROGRAMS\BioCiencia\BioCiencia (ventana propia).lnk" "$INSTDIR\BioCiencia.exe" "--ventana" "$INSTDIR\biociencia.ico" 0 SW_SHOWNORMAL "" "Abre BioCiencia en una ventana de Microsoft Edge sin pestañas"
  CreateShortCut "$SMPROGRAMS\BioCiencia\Desinstalar BioCiencia.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortCut "$DESKTOP\BioCiencia.lnk" "$INSTDIR\BioCiencia.exe" "" "$INSTDIR\biociencia.ico" 0 SW_SHOWNORMAL "" "Plataforma de investigación científica colaborativa"

  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\BioCiencia" "Carpeta" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "BioCiencia"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "BioCiencia (software libre)"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\biociencia.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM BioCiencia.exe /F'
  Pop $0
  Delete "$DESKTOP\BioCiencia.lnk"
  RMDir /r "$SMPROGRAMS\BioCiencia"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\BioCiencia.exe"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\TERCEROS.txt"
  Delete "$INSTDIR\LEAME.txt"
  Delete "$INSTDIR\biociencia.ico"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\BioCiencia"
  IfSilent +2
  MessageBox MB_ICONINFORMATION "BioCiencia se desinstaló.$\r$\n$\r$\nSus datos (biblioteca, proyectos, PDF) siguen guardados en el navegador. Si quiere borrarlos, haga antes una copia de seguridad y luego borre los datos del sitio 127.0.0.1 en la configuración del navegador."
SectionEnd
