# ROADMAP de BioCiencia

Leyenda: ✅ terminado y probado · 🟡 en curso · ⬜ pendiente · 🔎 requiere prueba en su PC

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Análisis de Consensus con REA y arquitectura | ✅ |
| 2 | Estructura, interfaz, navegación y base de datos local | ✅ (web verificada en su PC; 🔎 app Windows) |
| 3 | Búsqueda científica real con OpenAlex | ✅ verificada en su PC |
| 3b | Más fuentes: Crossref, PubMed, Europe PMC, arXiv, DOAJ + unificación | ⬜ |
| 4 | Exportación e importación (BibTeX, RIS, EndNote, CSV, CSL-JSON), historial, copias de seguridad | ✅ (EndNote verificado en su PC) |
| 5 | Sincronización entre dos computadoras (eventos firmados + Syncthing) | ✅ simulada (🔎 prueba real con dos PC y Syncthing) |
| 6 | Proyectos compartidos, invitaciones y permisos sincronizados | 🟡 lo básico ya está en la Fase 5; falta directorio de investigadores |
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

## Fase 4 — detalle

- ✅ Exportar en 6 formatos: BibTeX, RIS, EndNote etiquetado (.enw), EndNote XML, CSV para Excel (con acentos) y CSL-JSON; desde la biblioteca (vista filtrada) o un proyecto.
- ✅ Importar BibTeX, RIS y EndNote (.enw) con vista previa, avisos (sin título, DOI no válido) y sin duplicar; opción de añadir a colección o proyecto.
- ✅ Copia de seguridad completa (.json) y restauración atómica: si algo falla no se toca nada; sirve para pasar datos entre web y Windows.
- ✅ Borrar búsquedas del historial.
- ✅ Windows: diálogo nativo «Guardar como» y escritura limitada a extensiones permitidas.
- ✅ Errores encontrados por las pruebas de ida y vuelta y corregidos: llaves escapadas en BibTeX y palabras clave en EndNote.
- ✅ Pruebas: 25 nuevas (Vitest) + 1 de interfaz que descarga y revisa los 6 formatos y restaura en otro navegador.
- 🔎 Abrir los archivos exportados en Zotero y EndNote en su PC.

## Fase 5 — detalle

- ✅ Llaves Ed25519 por identidad con Web Crypto nativa (sin dependencias nuevas).
- ✅ Eventos firmados e inmutables con reloj HLC; reproducción determinista con permisos por rol.
- ✅ Conflictos: el mismo campo → gana el más reciente y el otro queda en el historial; campos distintos se combinan.
- ✅ Sincronización selectiva: solo proyectos compartidos y solo para sus miembros.
- ✅ Carpeta compartida (Syncthing / red / USB) con un archivo por dispositivo; tolera archivos a medio copiar.
- ✅ Paquetes manuales de sincronización (versión web, correo, USB).
- ✅ Interfaz: compartir proyecto, invitar por código, cambiar rol, retirar, historial de cambios, pantalla de sincronización con registro y modo automático.
- ✅ Pruebas: 14 de dos/tres nodos simulados + 3 de firmas (Vitest), 2 en Rust, 1 de interfaz con dos navegadores.
- 🔎 Prueba con dos PC Windows reales y Syncthing: pasos en `docs/SINCRONIZACION.md`.

## Verificado en la PC del usuario (2026-10-15)

- Windows + Node 24.21: `npm test` → 86 pruebas aprobadas.
- Versión web (`npm run dev:web`): búsqueda real en OpenAlex («Ralstonia solanacearum», 27.711 resultados, costo 0,001 USD).
- Cita descargada en formato EndNote (.enw) se abre correctamente en EndNote.

## Pendientes conocidos

- Licencia del proyecto por definir con el grupo.
- Búsqueda en vivo verificada solo desde el navegador del usuario; falta `npm run test:live` en su PC.
- Clave de API de OpenAlex (para superar el cupo gratuito de 0,10 USD/día): pendiente, se guardará en el Administrador de credenciales de Windows.
- Sincronización: falta la prueba con dos PC reales; los eventos están firmados pero no cifrados (cifrado por proyecto: Fase 11).
