#!/usr/bin/env bash
# Construye el instalador de Windows (BioCiencia-<versión>-instalador.exe) desde Linux o Windows (MSYS2).
# Requiere: Node.js (npm), MinGW-w64 (x86_64-w64-mingw32-gcc y windres) y NSIS (makensis).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
W=installer/windows
STAGE=$W/dist-instalador
OUT=$W/salida
rm -rf "$STAGE" && mkdir -p "$STAGE" "$OUT"

echo "1/4 Compilando la aplicación web…"
npm run build:web >/dev/null

echo "2/4 Compilando BioCiencia.exe…"
x86_64-w64-mingw32-windres "$W/recursos.rc" -O coff -o "$STAGE/recursos.o"
x86_64-w64-mingw32-gcc -O2 -s -Wall -Wextra -municode -mwindows -static "$W/biociencia.c" "$STAGE/recursos.o" -o "$STAGE/BioCiencia.exe" -lws2_32 -lshell32 -luser32
rm "$STAGE/recursos.o"
cp -r apps/web/dist "$STAGE/app"

echo "3/4 Textos (con fin de línea de Windows)…"
sed 's/$/\r/' LICENSE > "$W/LICENSE.txt"
sed 's/$/\r/' TERCEROS.md > "$W/TERCEROS.txt"
sed -i 's/\r*$/\r/' "$W/LEAME.txt"

echo "4/4 Empaquetando con NSIS…"
makensis -V2 -DVERSION="$VERSION" -DSRC=dist-instalador -DOUT="salida/BioCiencia-$VERSION-instalador.exe" "$W/BioCiencia.nsi"
( cd "$OUT" && sha256sum "BioCiencia-$VERSION-instalador.exe" > "BioCiencia-$VERSION-instalador.exe.sha256" )
ls -la "$OUT"
