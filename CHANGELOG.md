# Cambios

Formato basado en *Keep a Changelog*. Fechas en formato AAAA-MM-DD.

## [0.1.0-dev] — 2026-10-14

### Fase 2: estructura, interfaz y base de datos local

#### Añadido
- Monorepo con `packages/core`, `packages/storage`, `packages/ui`, `apps/web`, `apps/desktop`.
- Núcleo: identificadores ULID, normalización de DOI, PMID, OpenAlex y arXiv, clave de título para detectar duplicados sin identificadores, fusión de metadatos con registro de fuente, reloj lógico híbrido (HLC).
- Base de datos SQLite (migración 1): identidad, dispositivos, publicaciones, identificadores, registro de fuentes, índice de texto completo, búsquedas, biblioteca, etiquetas, colecciones, proyectos, miembros, notas, archivos, eventos y tablas de sincronización.
- Repositorio común para Windows y web con control de permisos por rol en proyectos.
- Versión web con SQLite WebAssembly en OPFS, manifiesto PWA y service worker para abrir sin conexión.
- Versión Windows con Tauri 2, SQLite nativo (rusqlite con FTS5), ventana sin consola, enlaces externos en el navegador predeterminado, configuración de instaladores NSIS y MSI en español.
- Interfaz original: inicio con buscador destacado, buscador (biblioteca local + historial), biblioteca, proyectos y ficha de proyecto, configuración; pantallas de fases futuras marcadas como pendientes.
- Ícono y logotipo propios.
- Pruebas: Vitest (23), Rust (4), Playwright (2).

#### Corregido durante la verificación
- El botón de menú móvil ocupaba una celda de la cuadrícula en escritorio y desarmaba la página.
- El botón «Buscar» se salía de la caja en pantallas de teléfono.
- Las etiquetas «F5…F9» del menú se leían como parte del nombre en lectores de pantalla.
- Contraste insuficiente del botón principal en modo oscuro.

### Fase 1: análisis y arquitectura
- Análisis funcional de Consensus con REA (ver `docs/ANALISIS-CONSENSUS.md`).
- Arquitectura local-first (ver `docs/ARQUITECTURA.md`).
