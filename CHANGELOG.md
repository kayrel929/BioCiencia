# Cambios

Formato basado en *Keep a Changelog*. Fechas en formato AAAA-MM-DD.

## [No publicado]

### Añadido
- **Más fuentes gratuitas en el Buscador** (2026-10-17): **OpenAIRE** (repositorios y tesis de todo el mundo), **arXiv** (preprints) y **Semantic Scholar** (citas y resúmenes). Ninguna pide clave. arXiv y Semantic Scholar se consultan con los puentes locales del lanzador (`/api/arxiv`, `/api/s2`), porque esos servicios no permiten que el navegador lea sus respuestas; OpenAIRE funciona directo.
- **Citas en otras bases** en cada publicación propia: OpenAlex y Semantic Scholar por DOI, con un enlace de búsqueda en Scopus.

- **El programa instalable (.exe) ya consulta arXiv, Semantic Scholar y OpenAI** (2026-10-17): esas llamadas se hacen ahora desde el backend de Tauri (Rust), que no está sujeto a las restricciones del navegador, así que ya no hace falta el puente HTTP del lanzador. Se añadió el plugin `tauri-plugin-http` y se sustituye `fetch` por el del plugin al arrancar la app de escritorio. El `.exe` deja de estar desfasado respecto a la versión web.

### Corregido
- El aviso de esas fuentes ahora explica qué pasó («pidió esperar un momento», «no respondió a tiempo») en lugar de «Revise su conexión a internet».
- **Los errores ya no culpan a su conexión** (2026-10-17): cuando un servicio no responde —por ejemplo el **502 de DOAJ** comprobado ese día— el aviso dice que puede estar saturado y sugiere reintentar. En el navegador, un error del propio servicio llega igual que un corte de internet, porque su respuesta no trae los permisos de lectura (CORS); por eso el mensaje anterior era engañoso. Corregido en `getText` (todas las fuentes) y en OpenAlex.
- **OpenAI (ChatGPT) ya funciona en BioCiencia** (2026-10-17): OpenAI no permite que una página del navegador lea sus respuestas, así que el programa las pide desde su propia computadora con el puente local `/api/openai` del lanzador, igual que ya hacía con arXiv y Semantic Scholar. Antes, aun con una clave correcta, la conexión fallaba con «No se pudo conectar». Además, la pantalla de IA avisa ahora de que **una suscripción a ChatGPT no es una clave de API**.


### Corregido (continuación, 2026-10-17)
- **Revisión completa de la aplicación**: se corrigieron varias fallas reales encontradas al revisar todo el programa:
  - **Pérdida de observaciones** al extraer datos con IA: `setLibraryNotes` sobrescribía lo que el usuario había escrito; ahora se añade sin borrar. Lo mismo en «Pasar a observaciones» del lector de PDF (que además añade la publicación a la biblioteca si no estaba). Nuevo método `appendLibraryNotes`.
  - **Un proyecto con revisión asociada no se podía compartir**: `rekeyProject` olvidaba la tabla `reviews` en la reasignación y rompía la clave foránea. Corregido.
  - **El formulario de un proyecto se vaciaba al refrescar en segundo plano** (sincronización, añadir una nota…): ahora se rellena una sola vez por proyecto.
  - **La pantalla de IA se rompía** si el proveedor guardado no era un preset conocido: se usa el primero como respaldo.
  - **Búsqueda en Semantic Scholar**: el filtro «Solo acceso abierto» no se aplicaba (ahora se filtra por artículo) y el parámetro `sort` se enviaba a un endpoint que no lo admite (ahora se ordena la página leída).
  - **`decodeEntities` lanzaba `RangeError`** con entidades numéricas fuera del rango Unicode (`&#x110000;`), tumbando la lectura de toda la fuente por un solo carácter.
  - **«Cargar más»** usaba el texto vivo del cuadro en vez de la consulta ejecutada: se mezclaban resultados de dos búsquedas.
  - **Mensaje engañoso** «Guardado» al re-guardar una recomendación que ya estaba; ahora dice «ya estaba en su biblioteca».
  - **Alta de identidad** sin manejo de error: ahora avisa si falla.
  - **Arranque web** sin aviso si el motor SQLite no carga: ahora se informa y no se queda en «Cargando…».
- **Proyectos deja de aparecer** a petición del usuario: se quitó de la barra lateral y de los lugares donde se mencionaba (tarjeta de Inicio, «Añadir a proyecto» del Buscador y la Biblioteca, selector de proyecto en Revisión, enlaces en Investigadores). Los datos se conservan; la pantalla de Sincronización se mantiene.


### Retirado
- **Los botones «Buscar en Google Académico»** (2026-10-17), a petición del usuario: desaparecen del Buscador, de «¿Dónde leerlo?» y de «Ver citas en otras bases». El perfil propio de Google Académico (sus citas, h e i10) se mantiene. «¿Dónde leerlo?» queda con dos caminos: acceso institucional y pedirlo al autor.

## [1.2.0] — 2026-10-15

### Añadido
- **Instalador de Windows** (`BioCiencia-1.2.0-instalador.exe`): sin Node.js ni permisos de administrador; accesos en escritorio y menú Inicio, desinstalador, ícono junto al reloj para abrir o salir. `BioCiencia.exe` es un servidor nativo (C) solo en 127.0.0.1:5173, con control de la cabecera Host. Probado con Wine (instalar, 28 pruebas de interfaz contra el programa instalado, desinstalar).
- **Avisos de retractación**: Crossref `updated-by` (Retraction Watch) y PubMed/Europe PMC «Retracted Publication»; botón «Revisar retracciones» en la biblioteca.
- **Nivel de evidencia**, **«muy citado»** y «mejor evidencia primero».
- **Ficha del estudio** sin IA con la frase de origen de cada dato.
- **Alertas**: seguir una búsqueda y ver las novedades en Inicio.
- **Medidor de evidencia** en el análisis con IA (excluye artículos retractados).
- Grupos inteligentes por nivel de evidencia y por retractación.

### Retirado
- Restos del editor científico (estilos y funciones de manuscritos sin uso; los datos antiguos se conservan).

## [1.1.0] — 2026-10-15

### Añadido (funciones de gestor de referencias, con diseño propio)
- **PDF** en cada publicación de la biblioteca: lectura, subrayado en colores con notas, búsqueda dentro del PDF, búsqueda de su texto desde la biblioteca, y uso de sus pasajes en el análisis con IA (dependencia nueva: `pdfjs-dist` 6.3.289, Apache 2.0).
- **10 865 estilos de cita CSL** con citeproc-js (dependencia nueva: `citeproc` 2.4.63, CPAL 1.0): bibliografía de la biblioteca, de un proyecto o de una publicación; copiar a Word, .docx, texto; importar `.csl`.
- **Grupos inteligentes** en la biblioteca.
- **Solicitar artículo completo**: carta muy formal al autor en español, inglés o ambos; detecta el correo del autor cuando Europe PMC lo publica.
- Copias de seguridad con o sin PDF.

### Retirado
- **Editor científico** (pedido del usuario). Los manuscritos guardados siguen en la base de datos y en las copias de seguridad.

## [1.0.1] — 2026-10-15

- Cada artículo (buscador, biblioteca, perfil, proyectos) tiene su **resumen**: vista previa, «Leer resumen completo» y «Buscar resumen» en Europe PMC / Crossref cuando la fuente no lo trajo (se guarda).
- Inicio sin búsquedas de ejemplo fijas.
- Licencia libre y gratuita: **MIT** (archivo `LICENSE`).

## [1.0.0-rc1] — 2026-10-15

### Fase 7: análisis con IA con citas verificadas
- Paquete `@biociencia/ai`: Ollama, LM Studio, OpenAI-compatibles y Anthropic; verificación de números de cita y de frases citadas.
- Pantalla «Análisis con IA»: preguntar a la biblioteca, evidencia para una afirmación, verificar una cita.
- Servicios en la nube solo con autorización; clave de IA fuera de las copias de seguridad.
- Corregido: los ajustes guardados podían pisar el proveedor elegido si se cambiaba antes de que terminaran de cargar.

### Fase 10: lanzador de Windows
- «Iniciar BioCiencia.cmd» y `scripts/servir.mjs` (`npm run app`); instalable como app (PWA).
- GitHub Actions: pruebas, instalador Windows y publicación web.

### Fase 12: documentación
- Guía de uso completa y pantalla «Ayuda» con buscador; README final.

## [0.1.0-dev] — 2026-10-15

### Perfil: citas, índice h, i10 y Scopus

#### Añadido
- Investigadores: tarjeta «Citas» con citas, índice h e i10 (todas y últimos 5 años) y gráfico por año (OpenCitations / Europe PMC); citas por artículo (abiertas y Crossref).
- Scopus opcional con clave personal: recuadro oficial por artículo y enlace al perfil de autor. CSP: `frame-src https://api.elsevier.com`.
- Migración 7 (`citation_counts`); la clave de Scopus se excluye de las copias de seguridad.

### Fase 3c: red de citas, tipo de estudio y revisión de literatura

#### Añadido
- «Red de citas» en el buscador y la biblioteca (Europe PMC y OpenCitations + Crossref).
- Filtros de tipo de estudio y de método (PubMed y Europe PMC); las demás fuentes se omiten y se informa.
- Pantalla «Revisión de literatura»: estrategia PICO/PEO, búsqueda en 4 bases, cribado, PRISMA 2020, informe Word. Migración 6 (`reviews`, `review_records`).
- OpenCitations en la lista permitida (CSP) de la web y de Windows.

#### Corregido
- Europe PMC repetía la primera página al pedir más resultados (ahora usa `cursorMark`).
- Una palabra clave `null` de Europe PMC detenía la unión de resultados.
- Consultas seguidas bloqueadas por Crossref y PubMed: pausas, espaciado y un reintento.

### Fase 11: seguridad y rendimiento

#### Añadido
- Copia de seguridad cifrada con contraseña (Configuración); la restauración detecta el archivo cifrado y pide la contraseña.
- `redact()` para limpiar registros; CSP en la versión web compilada; CSP de Windows con `object-src 'none'`, `base-uri`, `form-action` y `frame-ancestors`.
- Pruebas de seguridad (`tests/security`) y de rendimiento (`npm run test:perf`), docs/SEGURIDAD.md y docs/RENDIMIENTO.md.
- SHA-256 síncrono propio e identificadores ULID ligados a una llave.

#### Corregido
- Un miembro con acceso a la carpeta compartida podía apropiarse de un proyecto publicando una creación con fecha anterior. Ahora el identificador del proyecto está ligado a la llave de su creador; los proyectos anteriores reciben un identificador nuevo al compartirlos.
- La detección de citas `[@…]` tardaba segundos con texto malformado muy largo.
- El registro de sincronización podía guardar correos o rutas con el nombre de usuario.

### Fase 8: editor científico y estilos de cita

#### Añadido
- Pantalla Editor científico con plantillas, vista previa, guardado automático y diálogo «Insertar cita».
- Estilos APA 7 (español/inglés) y Vancouver sin dependencias (`cite.ts`), con desambiguación de autor-año y numeración por aparición.
- Exportación a Word (.docx) sin librerías (`docx.ts`, ZIP + CRC-32 propios), HTML y Markdown.
- Migración 5: columnas `volume`, `issue`, `pages` en `works` y tabla `manuscripts` (en la copia de seguridad).
- Volumen/número/páginas desde las 5 fuentes y en todos los formatos de importación/exportación.
- App Windows: comando `save_binary_file` y extensiones html, md y docx permitidas.

#### No incluido
- Coedición simultánea (CRDT), comentarios y sincronización de manuscritos.

### Fase 9: estadística

#### Añadido
- Pantalla Estadística: datos desde Excel/CSV, análisis descriptivo, t, ANOVA (DCA, DBCA, factorial) con Tukey y letras, supuestos, Kruskal-Wallis, correlación/regresión y χ²; interpretación y exportación CSV.
- Paquete `@biociencia/stats` (sin dependencias) verificado contra SciPy y statsmodels.
- Migración 4: tabla `datasets`, incluida en la copia de seguridad.

### Fase 6: perfil de investigador con ORCID y colaboradores

#### Añadido
- Pantalla Investigadores: ORCID del usuario, importación de sus publicaciones públicas desde orcid.org, completadas con Crossref; resumen por año y citas; exportar la lista.
- Migración 3: tabla `own_works` (publicaciones propias), incluida en la copia de seguridad.
- Biblioteca: botón «Es mía» y filtro «Mis publicaciones».
- Lista de colaboradores a partir de los proyectos compartidos.
- `normalizeOrcid` con dígito de control (ISO 7064 11,2).
- Al importar desde ORCID se unen las entradas repetidas con DOI distinto (mismo título y año), caso encontrado en un registro real (artículo de Bionatura con tres prefijos DOI).

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
