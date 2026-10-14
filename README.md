# BioCiencia

**Plataforma Inteligente de Investigación Científica Colaborativa**
*La ciencia conectada, el conocimiento compartido.*

BioCiencia es una aplicación local-first para investigadores: búsqueda científica,
biblioteca personal, proyectos de investigación y, en próximas fases, sincronización
P2P entre computadoras, asistente de IA con referencias verificables, editor de
manuscritos y estadística. Funciona en **Windows** (Tauri) y en el **navegador** (PWA),
con el mismo código.

> Estado: **v0.1.0 en desarrollo — Fase 2 completada.** Ver [ROADMAP.md](ROADMAP.md).

## Qué funciona hoy

- Identidad local (sin servidor).
- Biblioteca personal en SQLite: referencias manuales, favoritos, etiquetas,
  observaciones, colecciones y búsqueda de texto completo sin acentos, sin internet.
- Detección de duplicados por DOI (en cualquier formato), PMID, OpenAlex, arXiv
  o, en último caso, título + año + primer autor.
- Proyectos: nombre, descripción, objetivos, participantes con rol, notas y bibliografía.
- Permisos: solo los miembros ven un proyecto; los lectores no pueden editar.
- Interfaz propia con 11 pantallas, modo claro/oscuro y diseño adaptable a teléfono.
- Historial de búsquedas (se llenará con la búsqueda en línea de la Fase 3).

**Todavía no** (pantallas marcadas «Pendiente · Fase N»): búsqueda en línea en OpenAlex
(Fase 3), exportación BibTeX/RIS y copias de seguridad (Fase 4), sincronización (Fase 5),
invitaciones (Fase 6), IA y PDF (Fase 7), editor (Fase 8), estadística (Fase 9).

## Requisitos

| Programa | Versión | Para |
| --- | --- | --- |
| Node.js | 22.5 o superior (LTS) | Compilar la interfaz y ejecutar pruebas |
| Rust (rustup, toolchain `stable-x86_64-pc-windows-msvc`) | 1.77 o superior | App Windows |
| Visual Studio Build Tools con «Desarrollo de escritorio con C++» | 2022 o superior | Compilador que usa Rust |
| WebView2 | Incluido en Windows 10/11 actualizados | Ventana de la app |
| Git | cualquiera reciente | Control de versiones |

## Primeros pasos (Windows, PowerShell)

```powershell
cd C:\Users\<usuario>\BioCiencia
npm install          # descarga dependencias (una sola vez)
npm test             # pruebas automáticas del núcleo y la base de datos
npm run dev:web      # versión web en http://localhost:5173
npm run dev:desktop  # app Windows en modo desarrollo (primera vez tarda varios minutos)
```

Instalador de Windows: ver [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md).

## Estructura

```
packages/core      Identificadores, DOI, duplicados, reloj HLC (TypeScript)
packages/storage   Esquema SQL, migraciones y repositorio (mismo SQL en Windows y web)
packages/ui        Interfaz React (pantallas, componentes, estilos)
apps/web           Versión web/PWA: SQLite WebAssembly en OPFS
apps/desktop       Versión Windows: Tauri 2 + Rust
  src-tauri/db     Acceso a SQLite nativo (crate de Rust con pruebas propias)
tests/e2e          Pruebas de interfaz con Playwright
docs/              Arquitectura, análisis de referencia, guías
```

## Pruebas

| Comando | Qué prueba |
| --- | --- |
| `npm test` | Núcleo y base de datos con SQLite real (23 pruebas) |
| `cargo test --manifest-path apps/desktop/src-tauri/db/Cargo.toml` | SQLite nativo de Rust, FTS5, transacciones, copia (4 pruebas) |
| `npx playwright test` | Interfaz web completa en Chromium (2 pruebas) |
| `npm run typecheck` | Tipos de TypeScript |

## Dónde se guardan los datos

- **Windows:** `%APPDATA%\ec.biociencia.app\biociencia.db`
- **Web:** almacenamiento privado del navegador (OPFS). Borrar los datos del sitio borra la biblioteca.

## Acceso a texto completo

BioCiencia solo integra vías legales: copias de acceso abierto (Unpaywall, OpenAlex,
CORE, Europe PMC, SciELO, DOAJ, arXiv), el acceso institucional del propio usuario y la
solicitud directa al autor. No se conecta a servicios que distribuyen artículos sin
autorización de sus titulares.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — decisiones técnicas
- [docs/ANALISIS-CONSENSUS.md](docs/ANALISIS-CONSENSUS.md) — análisis funcional de referencia
- [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md) — compilar e instalar
- [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)
