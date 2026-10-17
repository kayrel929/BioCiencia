# BioCiencia

**Plataforma Inteligente de Investigación Científica Colaborativa**
*La ciencia conectada, el conocimiento compartido.*

Aplicación local-first para investigadores: búsqueda científica gratuita en varias bases de datos, biblioteca,
revisión de literatura con PRISMA, red de citas, proyectos compartidos entre computadoras con cambios firmados,
PDF con subrayados, bibliografías en más de 10 000 estilos de revista, estadística para experimentos, perfil ORCID con índice h y un
asistente de IA cuyas citas se verifican. Funciona en el **navegador** (PWA) y como **app de Windows** (Tauri),
con el mismo código. Los datos se guardan en la computadora del usuario; no hay servidor central.

> **Estado: versión 1.2.** Todas las funciones están construidas y probadas automáticamente (también el instalador, con Wine).
> Quedan pruebas que solo se pueden hacer en la PC del usuario (ver «Pendiente de verificar» en [ROADMAP.md](ROADMAP.md)).

## Para usar (Windows)

**Instalador:** doble clic en `BioCiencia-1.2.0-instalador.exe` (se construye con `scripts/instalador-windows.sh`). Si Windows avisa
«Windows protegió su PC»: «Más información» → «Ejecutar de todas formas». No necesita Node.js ni permisos de administrador;
BioCiencia queda en el escritorio y en el menú Inicio, y se cierra desde su ícono junto al reloj.

**Sin instalar:** con Node.js 22+, copie la carpeta a `C:\BioCiencia` y haga doble clic en «Iniciar BioCiencia.cmd».

Guía completa (también dentro de la app, menú **Ayuda**): [docs/GUIA_USUARIO.md](docs/GUIA_USUARIO.md).

## Funciones

| Módulo | Qué hace |
| --- | --- |
| Buscador | Europe PMC, PubMed, Crossref y DOAJ gratis a la vez (opcionales: OpenAlex, Semantic Scholar, arXiv y OpenAIRE), sin repetidos; filtros de año, acceso abierto, **tipo de estudio** y **método**; «¿Dónde leerlo?» con vías legales; descarga de citas; **resumen de cada artículo**; **red de citas** |
| Calidad de la evidencia | **Avisos de retractación** (Retraction Watch vía Crossref y PubMed), **nivel de evidencia** (metaanálisis … opinión), **«muy citado»**, «mejor evidencia primero» y **ficha del estudio** (muestra, diseño, lugar, organismos, duración, hallazgo) con la frase de origen de cada dato, sin IA |
| Alertas | **Seguir una búsqueda** y ver en Inicio solo las publicaciones nuevas |
| Revisión de literatura | Pregunta PICO/PEO, sinónimos, estrategia booleana por base, cribado con motivos, **diagrama PRISMA 2020**, texto de métodos, informe Word |
| Biblioteca | Búsqueda sin internet (también dentro de los PDF), etiquetas, colecciones, **grupos inteligentes**, notas; importa/exporta BibTeX, RIS, EndNote, CSV, CSL-JSON |
| PDF | Adjuntar PDF a cada publicación, leerlo, **subrayar en colores con notas**, buscar en su texto; la IA usa sus pasajes |
| Estilos de cita | **10 865 estilos CSL** (revistas, editoriales y normas), ~4 800 sin internet; copiar a Word, .docx o texto; importar `.csl` |
| Solicitar artículo | **Carta formal** al autor (español/inglés), con su correo cuando Europe PMC lo publica; Word, copiar o abrir en el correo |
| Proyectos y sincronización | Invitación por código, roles, cambios firmados Ed25519, historial, conflictos sin pérdida; carpeta compartida (Syncthing/USB/red) o paquete manual |
| Estadística | Descriptiva, t, ANOVA DCA/DBCA/factorial + Tukey, supuestos, Kruskal-Wallis, correlación/regresión, χ² (verificado contra SciPy/statsmodels) |
| Investigadores | ORCID → «Mis publicaciones»; **citas, índice h, i10** (todas y últimos 5 años) con datos abiertos; **Scopus** opcional con clave personal |
| Análisis con IA | Preguntar a la biblioteca, evidencia a favor/en contra con **medidor de evidencia**, verificar una cita. Ollama/LM Studio locales o servicios en la nube con autorización; **cada cita y cada frase citada se verifican sin IA** |
| Seguridad | Copias cifradas (AES-256), CSP, registros sin datos sensibles, proyectos ligados a la llave del creador |

## Lo que distingue a BioCiencia

- **Gratis y libre** (MIT), sin suscripción ni límite de búsquedas en las fuentes gratuitas.
- **Sus datos en su computadora**: biblioteca, PDF, notas y proyectos funcionan sin internet y no pasan por un servidor de terceros.
- **Nada inventado y todo verificable**: cada dato de la ficha del estudio muestra su frase; cada cita de la IA se comprueba sin IA; los artículos retractados se señalan.
- **Además de buscar**: revisión sistemática con PRISMA, gestor de referencias (PDF con subrayados, 10 865 estilos, grupos inteligentes), estadística para experimentos agrícolas, perfil ORCID con índice h y proyectos compartidos con firma digital.

## Lo que BioCiencia no hace (a propósito)

- No usa Sci-Hub ni fuentes no autorizadas: solo vías legales de acceso al texto completo.
- No trae datos de Google Académico (no tiene API pública) ni suma citas de Scopus (condiciones de Elsevier).
- No inventa referencias: toda publicación mostrada viene de una fuente real, y la IA solo puede citar las fuentes que se le entregan.

## Para desarrollar

```powershell
cd C:\BioCiencia
npm.cmd install
npm.cmd run dev:web        # desarrollo, http://localhost:5173
npm.cmd run app            # versión compilada, http://127.0.0.1:5173 (la que usa el lanzador)
npm.cmd test               # pruebas unitarias
npx playwright test        # pruebas de interfaz
npm.cmd run test:live      # contra las API reales (requiere internet)
npm.cmd run test:perf      # mediciones de rendimiento
```

App de Windows: `npm.cmd run dev:desktop` requiere Rust y Visual Studio Build Tools ([docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md)).
El instalador recomendado no necesita Rust: `scripts/instalador-windows.sh` (MinGW-w64 + NSIS) crea `BioCiencia-<versión>-instalador.exe`.
Para la versión nativa con Tauri, el flujo **«Instalador Windows»** de GitHub Actions (`.github/workflows/instalador-windows.yml`) compila el `.msi` y el `.exe` en los servidores de GitHub.

### Estructura

```
packages/core      Identificadores, duplicados, exportación/importación, Word, métricas, grupos inteligentes, cifrado
packages/cite      Estilos de cita CSL (catálogo de 10 865, 41 incluidos) con citeproc-js
packages/sources   Clientes de Europe PMC, PubMed, Crossref, DOAJ, arXiv, OpenAIRE, Semantic Scholar, OpenAlex, Unpaywall, ORCID, OpenCitations; revisión
packages/storage   Esquema SQLite (9 migraciones) y repositorio común (web y Windows)
packages/stats     Estadística sin dependencias
packages/sync      Firmas Ed25519, eventos, reproducción con permisos, motor de sincronización
packages/ai        Conexión con modelos (Ollama, OpenAI-compatibles, Anthropic) y verificación de citas
packages/ui        Interfaz React
apps/web           PWA: SQLite WebAssembly en OPFS
apps/desktop       Windows: Tauri 2 + Rust (rusqlite)
scripts/servir.mjs Servidor local del lanzador (solo 127.0.0.1)
installer/windows  BioCiencia.exe (servidor nativo en C, ícono junto al reloj) e instalador NSIS
tests/             Interfaz (Playwright), dos nodos simulados, seguridad, rendimiento, pruebas en vivo
docs/              Guía de uso, arquitectura, sincronización, seguridad, rendimiento
```

## Documentación

- [docs/GUIA_USUARIO.md](docs/GUIA_USUARIO.md) — guía de uso para el grupo
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) · [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md) · [docs/SEGURIDAD.md](docs/SEGURIDAD.md) · [docs/RENDIMIENTO.md](docs/RENDIMIENTO.md)
- [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md) · [packages/sources/tests/fixtures/FUENTES.md](packages/sources/tests/fixtures/FUENTES.md) (comportamiento verificado de cada API)
- [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)

## Licencia

**Libre y gratuita**: licencia [MIT](LICENSE). Cualquiera puede usar, copiar, modificar y compartir BioCiencia sin costo, también en otras instituciones, manteniendo el aviso de autoría. Componentes de terceros (pdf.js, citeproc-js, estilos CSL): [TERCEROS.md](TERCEROS.md).
