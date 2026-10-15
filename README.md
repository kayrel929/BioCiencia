# BioCiencia

**Plataforma Inteligente de Investigación Científica Colaborativa**
*La ciencia conectada, el conocimiento compartido.*

BioCiencia es una aplicación local-first para investigadores: búsqueda científica,
biblioteca personal, proyectos de investigación y, en próximas fases, sincronización
P2P entre computadoras, asistente de IA con referencias verificables, editor de
manuscritos y estadística. Funciona en **Windows** (Tauri) y en el **navegador** (PWA),
con el mismo código.

> Estado: **v0.1.0 en desarrollo — Fases 2 a 6 y 9 completadas** (la sincronización falta probarla con dos PC reales). Ver [ROADMAP.md](ROADMAP.md).

## Qué funciona hoy

- Identidad local (sin servidor).
- Biblioteca personal en SQLite: referencias manuales, favoritos, etiquetas,
  observaciones, colecciones y búsqueda de texto completo sin acentos, sin internet.
- Detección de duplicados por DOI (en cualquier formato), PMID, OpenAlex, arXiv
  o, en último caso, título + año + primer autor.
- Proyectos: nombre, descripción, objetivos, participantes con rol, notas y bibliografía.
- Permisos: solo los miembros ven un proyecto; los lectores no pueden editar.
- Interfaz propia con 11 pantallas, modo claro/oscuro y diseño adaptable a teléfono.
- Búsqueda científica real en OpenAlex: preguntas, palabras clave, título, autor (sin homónimos), revista o DOI; filtros por año, tipo, área, idioma, citas y acceso abierto; orden por relevancia, citas o fecha.
- Historial de búsquedas que se puede abrir sin internet ni costo; guardar resultados en la biblioteca o en un proyecto.
- Exportar referencias a BibTeX, RIS, EndNote (.enw y XML), CSV y CSL-JSON; importar desde Zotero, Mendeley, EndNote o JabRef sin duplicar.
- Copias de seguridad completas y restauración (también para pasar datos entre web y Windows).
- Proyectos compartidos entre computadoras: invitación por código, roles, cambios firmados, historial y conflictos resueltos sin perder datos.

- Búsqueda gratuita en Europe PMC, PubMed, Crossref y DOAJ a la vez (OpenAlex opcional), sin repetidos.
- Perfil con ORCID: importa sus publicaciones como «Mis publicaciones»; colaboradores de sus proyectos.
- «¿Dónde leerlo?»: copias legales gratuitas (Unpaywall), acceso institucional, pedir al autor, Google Académico.

- Estadística para experimentos: ANOVA DCA/DBCA/factorial con Tukey y letras, t, supuestos, correlación, χ².

**Todavía no** (pantallas marcadas «Pendiente · Fase N»): IA y PDF (Fase 7), editor (Fase 8).

Sincronización (cómo funciona y cómo probarla en dos PC): [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md).

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
packages/sources   Clientes de fuentes científicas (OpenAlex)
packages/storage   Esquema SQL, migraciones y repositorio (mismo SQL en Windows y web)
packages/stats     Estadística verificada contra SciPy (sin dependencias)
packages/sync      Firmas Ed25519, eventos, reproducción con permisos, motor de sincronización
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
| `npm test` | Núcleo, base de datos y cliente OpenAlex con respuestas reales grabadas (69 pruebas) |
| `npm run test:live` | Búsquedas reales en OpenAlex (~0,003 USD del cupo gratuito) y en las fuentes gratuitas (requiere internet; opcional `BC_EMAIL=su@correo` para Unpaywall) |
| `cargo test --manifest-path apps/desktop/src-tauri/db/Cargo.toml` | SQLite nativo de Rust, FTS5, transacciones, copia (4 pruebas) |
| `npx playwright test` | Interfaz web completa en Chromium (5 pruebas) |
| `npm run typecheck` | Tipos de TypeScript |

## Fuentes y costos

Por defecto se busca en **Europe PMC, PubMed, Crossref y DOAJ, que son gratuitas**. OpenAlex es opcional
(casilla en el buscador) y la búsqueda por título, autor o revista lo usa. arXiv y CORE no permiten llamadas
desde el navegador y quedan para la app de Windows. Detalles verificados: `packages/sources/tests/fixtures/FUENTES.md`.

OpenAlex cobra por uso: cada búsqueda cuesta 0,001 USD de un cupo gratuito diario de 0,10 USD
(unas 100 búsquedas por día y por conexión); buscar por DOI y el autocompletado no consumen cupo.
BioCiencia muestra el costo y el saldo en cada búsqueda, no repite una consulta idéntica en
10 minutos y guarda todo para consultarlo sin internet. Puede indicar su correo en
Configuración, como recomienda OpenAlex.

## Dónde se guardan los datos

- **Windows:** `%APPDATA%\ec.biociencia.app\biociencia.db`
- **Web:** almacenamiento privado del navegador (OPFS). Borrar los datos del sitio borra la biblioteca.

## Acceso a texto completo

BioCiencia solo integra vías legales. El botón «¿Dónde leerlo?» de cada artículo consulta Unpaywall
(copias legales en la editorial, PubMed Central y repositorios institucionales) y ofrece el acceso
institucional del propio usuario (proxy de su biblioteca), un correo preparado para pedir el artículo al
autor y la búsqueda en Google Académico (se abre en el navegador; Google no ofrece API). No se conecta a servicios que distribuyen artículos sin
autorización de sus titulares.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — decisiones técnicas
- [docs/ANALISIS-CONSENSUS.md](docs/ANALISIS-CONSENSUS.md) — análisis funcional de referencia
- [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md) — compilar e instalar
- [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)
