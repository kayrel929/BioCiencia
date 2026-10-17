# ROADMAP de BioCiencia

Leyenda: ✅ terminado y probado · 🟡 en curso · ⬜ pendiente · 🔎 requiere prueba en su PC

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Análisis de Consensus con REA y arquitectura | ✅ |
| 2 | Estructura, interfaz, navegación y base de datos local | ✅ (web verificada en su PC; 🔎 app Windows) |
| 3 | Búsqueda científica real con OpenAlex | ✅ verificada en su PC |
| 3b | Más fuentes: Crossref, PubMed, Europe PMC, DOAJ + unificación; acceso legal al texto completo | ✅ verificada en su PC |
| 3c | Red de citas, tipo de estudio/método y revisión de literatura con PRISMA (sin IA) | ✅ (APIs verificadas en vivo desde su navegador; 🔎 usarla en su PC) |
| 4 | Exportación e importación (BibTeX, RIS, EndNote, CSV, CSL-JSON), historial, copias de seguridad | ✅ (EndNote verificado en su PC) |
| 5 | Sincronización entre dos computadoras (eventos firmados + Syncthing) | ✅ simulada (🔎 prueba real con dos PC y Syncthing) |
| 6 | Proyectos compartidos, invitaciones, permisos, perfil con ORCID y colaboradores | ✅ (🔎 importar su propio ORCID) |
| 7 | IA con citas verificadas (Ollama/LM Studio locales o nube con permiso) | ✅ (🔎 probar con un modelo real en su PC; ⬜ lectura automática de PDF) |
| 8 | Editor científico (retirado en 1.1 a pedido del usuario) → estilos de cita CSL, PDF con subrayados, grupos inteligentes | ✅ v1.1 |
| 9 | Estadística (descriptiva, t, ANOVA DCA/DBCA/factorial, Tukey, supuestos, no paramétricas, correlación, χ²) | ✅ verificada contra SciPy/statsmodels |
| 10 | Lanzador de Windows (doble clic) e instalable como app; instalador y PWA por GitHub Actions | ✅ lanzador probado (🔎 instalador .msi y publicación web: ejecutar en GitHub; ⬜ firma digital) |
| 11 | Pruebas de seguridad, integración y rendimiento | ✅ (🔎 medir rendimiento en su PC) |
| 12 | Guía de uso (también dentro de la app) y documentación final | ✅ |

## Pendiente de verificar en su PC (no se puede hacer desde la nube)

- 🔎 Sincronización real entre dos computadoras con Syncthing (simulada con dos nodos en las pruebas).
- 🔎 IA con un modelo real (Ollama u otro): el flujo y la verificación están probados con respuestas simuladas.
- 🔎 Recuadro de Scopus con su clave personal.
- 🔎 Abrir el .docx exportado en Microsoft Word (probado con LibreOffice y python-docx).
- 🔎 Instalador .msi/.exe: ejecutar el flujo «Instalador Windows» en GitHub (o instalar Rust) y probarlo.
- 🔎 Rendimiento en su PC: `npm.cmd run test:perf`.
- 🔎 Leer y subrayar PDF reales de artículos (probado con un PDF generado para la prueba; los PDF con imágenes JPEG 2000 o fuentes no incrustadas pueden verse distintos).
- 🔎 Pegar en Word la bibliografía copiada (con cursivas) y abrir el .docx de referencias o de la carta.
- 🔎 «Abrir en mi correo» con su programa de correo (algunos cortan los mensajes largos; queda «Copiar carta»).

## Versión 1.2 — calidad de la evidencia e instalador

- ✅ Instalador NSIS de 64 bits + `BioCiencia.exe` nativo (MinGW-w64), probado con Wine: instalación, accesos, registro de desinstalación, una sola copia, servidor (403 a Host ajeno, 405 a POST, 404 a rutas fuera de `app`), 28 pruebas de interfaz contra el programa instalado y desinstalación.
- 🔎 Probar el instalador en su Windows real (aviso de SmartScreen por no tener firma comercial; ícono junto al reloj; «ventana propia» con Edge).
- ✅ Retracciones (Retraction Watch vía Crossref + PubMed), nivel de evidencia, «muy citado», ficha del estudio sin IA, alertas de búsquedas, medidor de evidencia.
- ⬜ Firma digital del instalador (requiere un certificado de pago).
- ⬜ Versión nativa con Tauri (ventana propia sin navegador): necesita compilar con Rust en Windows o el flujo de GitHub Actions.

## Versión 1.1 — gestor de referencias (pedido del usuario)

- ✅ Licencia MIT (libre y gratuita); `TERCEROS.md` con las licencias de pdf.js, citeproc-js y estilos CSL.
- ✅ Editor científico retirado del menú y de las rutas (la tabla `manuscripts` se conserva en la base para no perder datos antiguos).
- ✅ PDF: adjuntar (máx. 80 MB, se comprueba que sea PDF y se evita duplicar), leer con pdf.js, subrayar en 4 colores con nota, buscar en el texto, copiar o pasar a observaciones; texto indexado para la búsqueda de la biblioteca; la IA recibe los pasajes relevantes; copia de seguridad con o sin PDF (migración 8).
- ✅ Estilos CSL: catálogo de 10 865 estilos (repositorio oficial, commit fijo), 41 incluidos (~4 800 utilizables sin internet con los dependientes), descarga y guardado de los demás, importación de `.csl`, 10 idiomas; copiar con cursivas, Word, texto.
- ✅ Grupos inteligentes: 18 campos, Y/O, se recalculan solos.
- ✅ Solicitud formal del artículo al autor (es/en/ambos), correos de autores de Europe PMC (`resultType=core`), firma recordada, Word/copiar/correo.
- ⬜ Complemento de Word para citar mientras se escribe.
- ⬜ Abreviaturas de revistas para las referencias.
- ⬜ Búsqueda automática de PDF de acceso abierto para toda la biblioteca.
- ⬜ OCR de PDF escaneados.

## Fase 7 — detalle

- ✅ Paquete `@biociencia/ai` sin dependencias: Ollama (`/api/chat`, `/api/tags`), LM Studio y servicios compatibles con OpenAI (`/chat/completions`), Anthropic (cabecera para navegador). Direcciones permitidas fijas; claves del usuario fuera de las copias.
- ✅ **OpenAI por el puente local `/api/openai`** (2026-10-17): OpenAI no permite que el navegador lea sus respuestas (CORS), así que sus consultas las hace esta computadora desde el lanzador, igual que arXiv y Semantic Scholar. Antes fallaba aun con clave correcta.
- ✅ Verificación sin IA: números de cita inexistentes → `[?]` y aviso; cada «cita textual» se busca en el resumen (≥ 4 palabras, tolera mayúsculas, tildes, comillas, «…»); un «apoya/refuta» sin frase verificable no se cuenta.
- ✅ Pantalla: preguntar a la biblioteca (con texto pegado opcional), evidencia a favor/en contra (biblioteca + PubMed/Europe PMC), verificar una cita por DOI.
- ✅ Servicios en la nube bloqueados sin autorización expresa (prueba de interfaz: cero llamadas).
- ✅ Pruebas: 14 unitarias (resumen real de Europe PMC, respuestas de modelo escritas a mano con citas inventadas) y 2 de interfaz con Ollama simulado.
- 🔎 Sin modelo real disponible en la nube de desarrollo (descarga bloqueada): calidad de respuestas no evaluada.
- ✅ (v1.1) La IA usa los pasajes de los PDF adjuntos (pdf.js autorizado por el usuario).

## Fase 10 — detalle

- ✅ «Iniciar BioCiencia.cmd»: instala la primera vez, compila y abre `http://127.0.0.1:5173` con `scripts/servir.mjs` (sin dependencias; solo 127.0.0.1; tipos MIME correctos para WebAssembly; bloquea rutas fuera de la carpeta). Las 20 pruebas de interfaz pasan también contra este servidor.
- ✅ Instalable como app desde Chrome/Edge (PWA).
- ✅ Flujos de GitHub Actions: pruebas, instalador Windows (.msi y .exe sin firmar) y publicación web en GitHub Pages. 🔎 No ejecutados todavía (requieren un repositorio en GitHub).
- ⬜ Firma digital del instalador (requiere un certificado de pago).

## Fase 12 — detalle

- ✅ `docs/GUIA_USUARIO.md`: instalación, problemas frecuentes, cada módulo, IA, copias, privacidad y límites.
- ✅ Pantalla «Ayuda» que muestra la misma guía con buscador (sin HTML inyectado; prueba de interfaz).
- ✅ README final.

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

## Fase 3b — detalle

- ✅ Clientes de Crossref, PubMed (E-utilities), Europe PMC y DOAJ, todos gratuitos; OpenAlex queda opcional.
- ✅ Más fuentes gratuitas (2026-10-17): **OpenAIRE** (repositorios y tesis de todo el mundo, con filtros de año, acceso abierto y orden por citas) y **Semantic Scholar** (citas y resúmenes), además de **arXiv** por el puente local `/api/arxiv` (el navegador no puede leerla directamente). Las tres se activan o desactivan con casillas en el Buscador; ninguna necesita clave.
- ✅ Búsqueda en paralelo, unión de repetidos por DOI/PMID (con «Encontrado en: …»), resultados intercalados por relevancia.
- ✅ Si una fuente falla, las demás siguen y el error se muestra; con «solo acceso abierto» se omite Crossref (no puede filtrarlo).
- ✅ «¿Dónde leerlo?»: Unpaywall (copias legales), proxy institucional y correo al autor (los botones «Buscar en Google Académico» se retiraron el 2026-10-17 a petición del usuario).
- ✅ Configuración: correo de contacto (solo para estas APIs) y proxy de biblioteca.
- ✅ Vitest actualizado a 5.0.4: 0 vulnerabilidades.
- ✅ Pruebas: 22 nuevas con respuestas reales grabadas (verificadas con SHA-256) + 2 de interfaz; prueba en vivo de los clientes ejecutada en el navegador del usuario (4 fuentes y Unpaywall respondieron).
- ✅ arXiv (por el puente local `/api/arxiv`, porque su API no permite que el navegador la lea) y OpenAIRE: añadidas al buscador el 2026-10-17.
- ⛔ **CORE, CNKI y eLIBRARY.RU: descartadas el 2026-10-17 tras comprobarlas.**
  - **CNKI**: `robots.txt` = `Disallow: /` (todo el sitio prohíbe programas automáticos), es de pago y no tiene API pública.
  - **eLIBRARY.RU**: su `robots.txt` prohíbe la búsqueda, los autores, las citas y los títulos; sus páginas exigen cuenta y sus datos son por acuerdo de pago.
  - **CORE**: sin clave solo deja unas 5 consultas (nos informa «10 unidades» y gasta 2 por consulta) y luego bloquea con 429 durante un buen rato; su formulario de clave gratuita (`/api-keys/register`, el que enlaza su propio FAQ) está roto (404). No es fiable de forma automática. Su contenido (repositorios institucionales) llega igualmente por **OpenAIRE**.
  - Alternativas libres también descartadas: CyberLeninka (su `robots.txt` prohíbe `/api/`), ChinaXiv (en mantenimiento) y SciEngine (bloquea a los agentes automáticos).
- ⬜ SciELO directo: sin API JSON estable; sus revistas llegan por Crossref, DOAJ y OpenAlex.

## Perfil: citas e índices (añadido a la Fase 6)

- ✅ Citas totales, índice h e índice i10 («Todas» y «Desde» los últimos 5 años) y citas por año, al estilo de los perfiles académicos, con datos abiertos (OpenCitations con DOI; Europe PMC solo con PMID). Migración 7 (`citation_counts`).
- ✅ Verificado en vivo con el ORCID del usuario: 7 artículos con DOI → 5 citas, índice h 1 (datos abiertos; suelen ser menos que Google Académico).
- ✅ Scopus opcional con la clave gratuita del propio usuario (dev.elsevier.com): recuadro oficial de Elsevier por artículo, que enlaza a Scopus; enlace al perfil de autor de Scopus para su índice h oficial. Por las condiciones de Elsevier no se suman ni se calculan índices con esos números. La clave no viaja en las copias de seguridad.
- 🔎 Probar el recuadro de Scopus con su propia clave (sin clave real no se pudo probar; se verificó que la API responde al navegador y rechaza claves inválidas).
- ⬜ Google Académico no tiene API pública: sus números no se pueden traer.

## Fase 3c — detalle (pedida al comparar con Consensus; diseño propio, sin copiar)

- ✅ Red de citas («bola de nieve»): quién cita una publicación y qué cita, varios niveles, guardar y exportar. Europe PMC (con PMID) y OpenCitations + Crossref (solo DOI).
- ✅ Filtro por tipo de estudio (clasificación oficial de PubMed: metaanálisis, revisión sistemática, ensayo aleatorizado, observacional, reporte de caso, guía…) y por método (ensayo de campo, invernadero, in vitro, molecular, encuesta, modelación, sensores remotos) en PubMed y Europe PMC.
- ✅ Revisión de literatura: pregunta PICO/PEO, conceptos y sinónimos, estrategia booleana por base, búsqueda paginada, unión de repetidos, cribado con motivos, diagrama PRISMA 2020, texto de métodos, informe .docx, exportación de incluidos (migración 6).
- ✅ Errores reales encontrados y corregidos: Europe PMC ignora `page` (ahora `cursorMark`, también arregla «Cargar más» del buscador); `null` en palabras clave de Europe PMC rompía la unión; bloqueos por consultas seguidas en Crossref y PubMed (pausas y reintento).
- ✅ Pruebas: 20 nuevas unitarias (con 6 respuestas reales grabadas), 2 de interfaz; verificación en vivo: red de citas (42 referencias / 87 citas en Europe PMC; 2 citas y 30 referencias vía OpenCitations), filtros, y revisión en 4 bases (PubMed 54, Europe PMC 105, Crossref 200 de 104 860, DOAJ 15 → 285 únicos).
- ⬜ Con IA (Fase 7, requiere su autorización): chatear con la biblioteca, búsqueda inversa de citas, verificar si una cita respalda una afirmación, informe automático.
- ⬜ Cribado de texto completo y extracción de datos dentro de la app; trabajo de dos revisores en paralelo.

## Fase 11 — detalle

- ✅ Copias de seguridad cifradas con contraseña (PBKDF2 600 000 + AES-256-GCM), restauración en otro navegador probada.
- ✅ Registros sin datos sensibles (`redact`): correos, tokens, llaves, usuario en rutas.
- ✅ CSP en la web compilada y reforzada en la app Windows; prueba de que un script inyectado no se ejecuta.
- ✅ **Corregido:** apropiación de un proyecto compartido con una creación antedatada (identificador ligado a la llave del creador).
- ✅ **Corregido:** expresión de citas con tiempo cuadrático ante texto malformado.
- ✅ Pruebas: 14 de seguridad (cifrado, registros, XSS, SQL, 500 archivos aleatorios, entradas patológicas, SHA-256), 2 de sincronización, 2 de interfaz.
- ✅ Rendimiento medido (docs/RENDIMIENTO.md): 5 000 publicaciones, 2 000 eventos firmados, 20 000 datos estadísticos, manuscrito de 4 000 párrafos.
- ✅ `npm audit` y `cargo audit`: 0 vulnerabilidades (2 avisos en dependencias de Linux). Detalle en docs/SEGURIDAD.md.
- 🔎 Ejecutar `npm.cmd run test:perf` en su PC.
- ⬜ Auditoría externa / pruebas de penetración por terceros.

## Fase 8 — detalle

- ✅ Pantalla Editor científico: lista de manuscritos, plantillas (artículo IMRyD, nota corta, informe técnico, en blanco), proyecto y estilo por manuscrito; guardado automático (migración 5, tabla `manuscripts`, incluida en la copia de seguridad).
- ✅ Escritura en Markdown sencillo con barra de formato (sección, subsección, negrita, cursiva, lista) y vista previa al lado.
- ✅ Citas desde la biblioteca: diálogo «Insertar cita» (busca por autor, título, año o DOI; varias a la vez) que escribe `[@clave]`; las claves que no existen se avisan y no se inventan.
- ✅ Estilos sin dependencias: APA 7 en español e inglés (y/&, s. f./n.d., hasta 20 autores y regla de 21+, desambiguación 2021a/2021b, orden alfabético, cursivas) y Vancouver (numeración por aparición, rangos [1-3], 6 autores + et al).
- ✅ Volumen, número y páginas: se guardan desde Crossref, PubMed, Europe PMC, DOAJ y OpenAlex (verificado con respuestas reales grabadas) y se importan/exportan en BibTeX, RIS, EndNote y CSL-JSON.
- ✅ Exportación a Word (.docx propio, sin librerías: Times 12, doble espacio, títulos con estilos de Word, referencias con sangría francesa), HTML y Markdown. El .docx se verificó abriéndolo con python-docx y LibreOffice en la nube.
- ✅ Pruebas: 16 de estilos/manuscrito/docx, 3 de almacenamiento, 4 de fuentes con datos reales, 1 de interfaz completa.
- 🔎 Abrir el .docx exportado en Microsoft Word de su PC (solo se probó con LibreOffice).
- ⬜ Edición simultánea por dos personas (CRDT) y comentarios: no incluido. Los manuscritos todavía no se sincronizan entre computadoras.
- ⬜ Más estilos (Chicago, IEEE, CSL arbitrarios) y exportar a PDF (por ahora: abrir el .docx o el HTML e imprimir a PDF).

## Fase 9 — detalle

- ✅ Paquete `@biociencia/stats` sin dependencias: distribuciones normal, t, F, χ² y rango studentizado (algoritmo de R).
- ✅ Descriptiva (media, DE, EE, CV, cuartiles, IC 95 %), t de Welch/Student/pareada, ANOVA DCA, DBCA y factorial A×B, Tukey HSD con letras, Levene, Shapiro-Wilk, Kruskal-Wallis, Pearson, Spearman, regresión lineal, χ².
- ✅ Datos pegados desde Excel (tabulador, punto y coma, coma decimal) o CSV; filas incompletas se omiten y se avisa; conjuntos de datos guardados (migración 4).
- ✅ Interpretación en español, supuestos del ANOVA, exportación de resultados a CSV.
- ✅ Verificación: 22 pruebas contra valores de SciPy 1.18 y statsmodels 0.15 (script reproducible en `packages/stats/tests/ref`), incluido el conjunto clásico PlantGrowth; 2 pruebas de interfaz.

## Fase 6 — detalle

- ✅ Invitaciones, roles e historial firmados (hechos en la Fase 5).
- ✅ Mi perfil de investigador: ORCID con validación del dígito de control; nombre del registro y aviso si no coincide.
- ✅ Importar «Mis publicaciones» desde el ORCID público (gratis, sin contraseña), completadas con coautores, resumen y citas de Crossref; sin duplicar; se actualizan cuando se quiera.
- ✅ Marcar o desmarcar publicaciones propias desde la Biblioteca; filtro «Mis publicaciones»; exportar la lista (BibTeX, RIS, EndNote…).
- ✅ Colaboradores: personas con las que comparte proyectos y su rol.
- ✅ Pruebas: 5 (ORCID con respuestas reales de la cuenta de demostración oficial) + 1 (almacenamiento) + 2 de interfaz.

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
- `npm.cmd run test:live`: OpenAlex (3 pruebas), Crossref, PubMed, Europe PMC, DOAJ, búsqueda combinada y Unpaywall aprobadas en vivo. La prueba de ORCID rechazó correctamente el número de ejemplo 0000-0000-0000-0000 (dígito de control inválido); falta repetirla con un ORCID real.

## Pendientes conocidos

- Licencia del proyecto por definir con el grupo.
- Búsqueda en vivo verificada solo desde el navegador del usuario; falta `npm run test:live` en su PC.
- Clave de API de OpenAlex (para superar el cupo gratuito de 0,10 USD/día): pendiente, se guardará en el Administrador de credenciales de Windows.
- Sincronización: falta la prueba con dos PC reales; los eventos están firmados pero no cifrados (cifrado por proyecto: Fase 11).
