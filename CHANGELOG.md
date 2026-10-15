# Cambios

Formato basado en *Keep a Changelog*. Fechas en formato AAAA-MM-DD.

## [0.1.0-dev] — 2026-10-15

### Fase 6: perfil de investigador con ORCID y colaboradores

#### Añadido
- Pantalla Investigadores: ORCID del usuario, importación de sus publicaciones públicas desde orcid.org, completadas con Crossref; resumen por año y citas; exportar la lista.
- Migración 3: tabla `own_works` (publicaciones propias), incluida en la copia de seguridad.
- Biblioteca: botón «Es mía» y filtro «Mis publicaciones».
- Lista de colaboradores a partir de los proyectos compartidos.
- `normalizeOrcid` con dígito de control (ISO 7064 11,2).

### Fase 3b: fuentes gratuitas y acceso legal al texto completo

#### Añadido
- Fuentes gratuitas: Crossref, PubMed (E-utilities), Europe PMC y DOAJ, con filtros de año, acceso abierto y orden verificados en las API reales.
- Búsqueda combinada: consultas en paralelo, unión de repetidos, resultado por fuente y errores visibles.
- Selector de fuentes en el buscador (se recuerda); OpenAlex opcional, indicando su costo.
- «¿Dónde leerlo?» en el buscador y la biblioteca: Unpaywall, acceso institucional, correo al autor, Google Académico.
- «Buscar también en Google Académico» para la consulta completa.
- Configuración «Fuentes científicas y acceso al texto completo»: correo de contacto y proxy de biblioteca.
- Respuestas reales grabadas y documentadas en `packages/sources/tests/fixtures/FUENTES.md`; prueba en vivo `tests/live/fuentes.live.test.ts`.

#### Cambiado
- Vitest 3 → 5.0.4 (quita 3 vulnerabilidades de la herramienta de pruebas; la app no cambia).
- La app de Windows permite conectarse a las nuevas fuentes (CSP) y abre los correos `mailto:` en el programa de correo.


### Mejoras tras la prueba en la PC del usuario
- Verificado en Windows con Node 24.21: 86 pruebas aprobadas y búsqueda real en OpenAlex desde la versión web.
- Nuevo: «Descargar cita…» en cada resultado del buscador y de la biblioteca (EndNote .enw/XML, RIS, BibTeX, CSV, CSL-JSON), sin necesidad de guardarlo antes.
- Nuevo: «Exportar estos resultados» en el buscador.


### Fase 5: sincronización entre computadoras

#### Añadido
- Paquete `@biociencia/sync`: firmas Ed25519 (Web Crypto nativa), eventos firmados, reproducción determinista con permisos (`replayProject`), motor `SyncEngine`, transporte por carpeta y paquetes manuales.
- Migración 2: tablas `identity_keys` y `sync_events`.
- Repositorio: cambios en proyectos compartidos se firman automáticamente; `materializeProject`, `listProjectWorks`, `deleteNote`, registro de sincronización.
- Windows: comandos `sync_list`, `sync_read`, `sync_append` (nombres validados, solo dentro de la carpeta elegida) y elección de carpeta con diálogo nativo.
- Interfaz: pantalla Sincronización (código de investigador, carpeta, sincronizar ahora/automático, paquetes, registro); en el proyecto: compartir, invitar, roles, retirar e historial de cambios.
- Documentación: `docs/SINCRONIZACION.md` con la guía de prueba en dos PC con Syncthing.

#### Cambiado
- Al restaurar una copia de seguridad se asigna un id de dispositivo nuevo (dos PC no deben escribir el mismo archivo de sincronización).
- La bibliografía del proyecto se lista desde el proyecto, no desde la biblioteca personal.
- La copia de seguridad avisa que contiene la llave privada de firma.


### Fase 4: referencias, historial y copias de seguridad

#### Añadido
- Exportación a BibTeX, RIS, EndNote etiquetado (.enw), EndNote XML, CSV (Excel, con BOM UTF-8) y CSL-JSON, con claves de cita únicas y separación correcta de apellidos (incluidas partículas como «de la», «van»).
- Importación de BibTeX (llaves anidadas, comillas, acentos LaTeX, @comment/@string), RIS (líneas de continuación, DOI en URL) y EndNote .enw, con avisos y sin duplicados.
- Biblioteca: botones Importar y «Exportar esta vista»; proyectos: exportar su bibliografía.
- Configuración: copia de seguridad completa y restauración atómica entre web y Windows.
- Buscador: borrar entradas del historial.
- Windows: plugin de diálogo de Tauri y comando `save_text_file` con lista de extensiones permitidas y escritura atómica.

#### Corregido
- BibTeX: las llaves escapadas (`\{ \}`) se perdían al importar.
- EndNote: las palabras clave se unían en una sola al exportar.
- La fuente «import» se mostraba sin traducir.


### Fase 3: búsqueda científica real (OpenAlex)

#### Añadido
- Paquete `@biociencia/sources` con cliente de OpenAlex verificado contra la API real: búsqueda, filtros, orden, paginación, DOI, autocompletado de autores (con institución y ORCID) y revistas.
- Preparación de preguntas en lenguaje natural con lista de palabras vacías en español e inglés; la consulta enviada se muestra al usuario.
- Pantalla Buscador: modos pregunta/palabras clave, título, autor y revista; panel de filtros; guardar en biblioteca o proyecto; cargar más; historial que abre búsquedas guardadas sin conexión.
- Indicación del costo de cada consulta y del saldo gratuito diario de OpenAlex.
- Correo de contacto para OpenAlex en Configuración.
- Repositorio: `saveSearch` devuelve el id local de cada resultado; `appendSearchResults` y `libraryMembership`.
- Pruebas: respuestas reales de OpenAlex grabadas como datos de prueba; prueba en vivo `npm run test:live` para la PC del usuario.

#### Verificado en la API real (2026-10-14)
- CORS abierto (`Access-Control-Allow-Origin: *`): la web y la app Windows consultan directo, sin servidor intermedio.
- Costos: búsqueda o lista 0,001 USD; DOI y autocompletado 0 USD; cupo gratuito sin clave 0,10 USD por día.


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
