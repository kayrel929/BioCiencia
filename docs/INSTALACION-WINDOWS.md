# Compilar, ejecutar e instalar BioCiencia en Windows

Todos los comandos se escriben en **PowerShell** dentro de la carpeta del proyecto.

## 1. Preparar el equipo (una sola vez)

1. **Node.js LTS** (22.x): https://nodejs.org → instalar con opciones por defecto.
   Comprobar: `node --version` (debe ser v22.5 o superior).
2. **Visual Studio Build Tools**: en el instalador de Visual Studio, marcar
   **«Desarrollo de escritorio con C++»** (incluye MSVC y Windows SDK).
3. **Rust**: descargar `rustup-init.exe` desde https://rustup.rs y aceptar las opciones
   por defecto (toolchain `stable-x86_64-pc-windows-msvc`).
   Cerrar y abrir PowerShell. Comprobar: `rustc --version`.
4. **WebView2**: viene con Windows 11 y Windows 10 actualizado. Si falta, el instalador
   de BioCiencia lo descargará.

## 2. Instalar dependencias del proyecto

```powershell
cd C:\Users\<usuario>\BioCiencia
npm install
```

## 3. Probar

```powershell
npm test
cargo test --manifest-path apps\desktop\src-tauri\db\Cargo.toml
```

Ambos deben terminar sin fallos. Envíe la salida si alguno falla.

## 4. Abrir en modo desarrollo

```powershell
npm run dev:desktop
```

La primera vez compila Rust y puede tardar 5–15 minutos. Se abrirá la ventana BioCiencia.

## 5. Generar el instalador

```powershell
npm run build:desktop
```

Los instaladores quedan en:

- `apps\desktop\src-tauri\target\release\bundle\nsis\BioCiencia_0.1.0_x64-setup.exe`
- `apps\desktop\src-tauri\target\release\bundle\msi\BioCiencia_0.1.0_x64_es-ES.msi`

El `.exe` (NSIS) instala solo para el usuario actual y no requiere permisos de administrador.

**Aviso de SmartScreen:** como el instalador no está firmado con un certificado de
código, Windows mostrará «Windows protegió su PC». Pulse *Más información → Ejecutar de
todas formas*. Firmar el instalador requiere comprar un certificado (Fase 10).

## 6. Versión web

```powershell
npm run dev:web        # desarrollo: http://localhost:5173
npm run build:web      # versión publicable en apps\web\dist
```

`apps\web\dist` se puede publicar en cualquier hosting estático con HTTPS
(GitHub Pages, Cloudflare Pages). Los datos quedan en el navegador de cada usuario.

## Datos

- Base de datos: `%APPDATA%\ec.biociencia.app\biociencia.db`
- Desinstalar la app **no** borra esa carpeta, para no perder la biblioteca.
