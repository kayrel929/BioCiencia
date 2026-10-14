# ROADMAP de BioCiencia

Leyenda: ✅ terminado y probado · 🟡 en curso · ⬜ pendiente · 🔎 requiere prueba en su PC

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Análisis de Consensus con REA y arquitectura | ✅ |
| 2 | Estructura, interfaz, navegación y base de datos local | ✅ (🔎 abrir en Windows) |
| 3 | Búsqueda científica real con OpenAlex | ✅ (🔎 `npm run test:live` en su PC) |
| 3b | Más fuentes: Crossref, PubMed, Europe PMC, arXiv, DOAJ + unificación | ⬜ |
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

## Fase 3 — detalle

- ✅ Cliente OpenAlex: búsqueda, filtros (año, tipo, área, idioma, citas mínimas, acceso abierto, autor, revista), orden, paginación, DOI exacto, autocompletado de autores y revistas.
- ✅ Preparación de preguntas en lenguaje natural (se muestra la consulta enviada); operadores AND/OR/NOT y comillas se respetan.
- ✅ Resultados guardados en el historial; las búsquedas guardadas se abren sin internet ni costo.
- ✅ Guardar en biblioteca o en proyecto desde los resultados.
- ✅ Errores reales informados (sin conexión, tiempo agotado, límite de uso 429, consulta inválida 400) y registrados en el historial.
- ✅ Costo por consulta y saldo diario visibles (OpenAlex cobra por uso desde 2026).
- ✅ Pruebas: 21 nuevas (análisis de respuestas reales grabadas, consultas, errores, integración con SQLite) + 2 de interfaz.
- 🔎 Prueba en vivo contra OpenAlex: `npm run test:live` en su PC (la nube de desarrollo no tiene acceso).

## Pendientes conocidos

- Licencia del proyecto por definir con el grupo.
- Exportación de referencias: se implementa en la Fase 4 (requisito de la v0.1).
- Búsqueda en vivo verificada solo desde el navegador del usuario; falta `npm run test:live` en su PC.
- Clave de API de OpenAlex (para superar el cupo gratuito de 0,10 USD/día): pendiente, se guardará en el Administrador de credenciales de Windows.
- Sincronización básica entre dos PC: Fase 5 (requisito de la v0.1).
