# ROADMAP de BioCiencia

Leyenda: ✅ terminado y probado · 🟡 en curso · ⬜ pendiente · 🔎 requiere prueba en su PC

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Análisis de Consensus con REA y arquitectura | ✅ |
| 2 | Estructura, interfaz, navegación y base de datos local | ✅ (🔎 abrir en Windows) |
| 3 | Búsqueda científica real (OpenAlex; luego Crossref, PubMed, Europe PMC, arXiv, DOAJ) | ⬜ |
| 4 | Historial completo, exportación BibTeX/RIS/CSV, importación, copias de seguridad | ⬜ |
| 5 | Sincronización entre dos computadoras (eventos firmados + Syncthing) | ⬜ |
| 6 | Proyectos compartidos, invitaciones y permisos sincronizados | ⬜ |
| 7 | IA (Ollama local / API con permiso) y análisis de PDF | ⬜ |
| 8 | Editor científico, CRDT y estilos de cita | ⬜ |
| 9 | Estadística | ⬜ |
| 10 | Instalador Windows firmado y PWA publicada | ⬜ |
| 11 | Pruebas de seguridad, integración y rendimiento | ⬜ |
| 12 | Documentación y despliegue para el grupo | ⬜ |

## Fase 2 — detalle

- ✅ Monorepo (npm workspaces) con Git.
- ✅ Núcleo: ULID, normalización de DOI/PMID/OpenAlex/arXiv, claves de duplicados, fusión de metadatos, reloj HLC.
- ✅ Esquema SQLite (migración 1) con 20 tablas + índice FTS5 sin acentos.
- ✅ Repositorio común: identidad, publicaciones sin duplicados, historial, biblioteca, etiquetas, colecciones, proyectos, roles, notas.
- ✅ Adaptadores: Node (pruebas), WebAssembly/OPFS (web), Rust/rusqlite (Windows).
- ✅ Interfaz original: 11 pantallas, modo claro/oscuro, adaptable a teléfono, ícono propio.
- ✅ Pruebas: 23 (TypeScript) + 4 (Rust) + 2 de interfaz en Chromium.
- 🔎 Abrir la app Windows en su PC (`npm run dev:desktop`) y confirmar.

## Pendientes conocidos

- Licencia del proyecto por definir con el grupo.
- Exportación de referencias: se implementa en la Fase 4 (requisito de la v0.1).
- Búsqueda en línea: Fase 3 (requisito de la v0.1); desde el entorno de desarrollo en la nube OpenAlex está bloqueado, se probará en su PC.
- Sincronización básica entre dos PC: Fase 5 (requisito de la v0.1).
