# Arquitectura de BioCiencia

Documento completo con diagramas (en línea): «BioCiencia — Arquitectura y Fase 1».
Este archivo resume las decisiones para quien trabaje con el código.

## Principios

1. **Local-first:** cada computadora tiene su base de datos completa; internet solo hace falta para buscar en fuentes externas, descargar PDF de acceso abierto, usar IA en línea o sincronizar a distancia.
2. **Un solo código:** la lógica y la interfaz viven en `packages/`; cada app solo aporta su adaptador (`SqlDriver`).
3. **Nada se inventa:** los datos de una publicación siempre indican su fuente y fecha; las funciones no implementadas se muestran como pendientes.
4. **Solo vías legales** para el texto completo.

## Capas

| Capa | Paquete | Windows | Web |
| --- | --- | --- | --- |
| Interfaz | `packages/ui` | React en WebView2 | React en el navegador |
| Lógica | `packages/core` | TypeScript | TypeScript |
| Estilos de cita | `packages/cite` | citeproc-js + estilos CSL | citeproc-js + estilos CSL |
| PDF | `packages/ui/src/pdf.ts` | pdf.js (versión legacy) en WebView2 | pdf.js en el navegador |
| Datos | `packages/storage` | SQLite nativo vía comandos Rust (`src-tauri/db`) | SQLite WebAssembly en OPFS (hilo dedicado) |
| Red | — | HTTP desde la WebView / Rust | `fetch` (CORS) |
| Sincronización (F5) | `packages/sync` | Eventos firmados + Syncthing; luego iroh | Archivo de intercambio o nodo de escritorio |

## Base de datos

- Esquema en `packages/storage/src/migrations.ts`. Las migraciones nunca se editan; se agregan.
- Publicaciones: tabla `works` + `work_ids` (DOI, PMID, OpenAlex, arXiv, titlehash) para reconocer duplicados.
- `sources_log` registra cada fuente que aportó datos y cuándo.
- `works_fts`: índice FTS5 con `remove_diacritics 2` (busca «biologico» y encuentra «biológico»).
- Borrados lógicos (`deleted = 1`) para no perder historial y para la sincronización futura.

## Sincronización (implementada, Fase 5)

- Solo los **proyectos compartidos** generan eventos: `{v, id (ULID), project, author, authorKey, device, hlc, type, data, sig}`, firmados con Ed25519 sobre JSON canónico.
- Tipos: `project.create/update/archive`, `member.set/remove`, `work.add/remove`, `note.add/delete`.
- Tablas: `sync_events` (texto original + estado aceptado/rechazado) e `identity_keys`.
- `replayProject` es una función pura: mismo conjunto de eventos → mismo estado en cualquier computadora. Aplica permisos y último-escritor-gana por campo (HLC), con el historial de lo reemplazado.
- El resultado se materializa en las tablas normales (`projects`, `project_members`, `project_works`, `notes`), así el resto de la app no cambia.
- Transporte: `<carpeta>/<proyecto>/<dispositivo>.ndjson`, solo-agregar, un archivo por dispositivo (sin conflictos en Syncthing). Paquetes `.json` para la web.
- Detalle y guía de prueba: [SINCRONIZACION.md](SINCRONIZACION.md).
- Futuro: cifrado por proyecto (Fase 11), CRDT (Yjs) para manuscritos (Fase 8).

## Seguridad

- Sin contraseñas en texto plano: la identidad es local; las llaves Ed25519 (Fase 5) se guardan en la base local; pasarlas al Administrador de credenciales de Windows queda para la Fase 11.
- Claves de API del usuario nunca en el código; guardadas en el sistema (Windows) y enviadas solo a su proveedor.
- La consulta FTS se construye escapando cada palabra (`toFtsQuery`); todo el SQL usa parámetros.
- CSP restrictiva en Tauri; los enlaces externos se abren en el navegador del sistema.

## Fase 7: IA con verificación (añadido)

`packages/ai` no depende de librerías: habla con Ollama (`http://127.0.0.1:11434`), LM Studio y servicios
compatibles con OpenAI o con Anthropic mediante `fetch`. Las direcciones posibles están fijas en el código y en la
CSP. OpenAI no permite que el navegador lea sus respuestas (CORS), así que sus consultas pasan por el puente local
`/api/openai` de `scripts/servir.mjs` (el mismo sistema que `/api/s2` y `/api/arxiv`); la clave sigue guardándose
solo en esta computadora. La recuperación de fuentes es local (búsqueda de texto completo en SQLite con términos que propone el modelo)
o en PubMed/Europe PMC. La verificación (`grounding.ts`) es determinista: no confía en el modelo para decidir si
una cita existe.

## Fase 10: distribución sin compilar Rust (añadido)

`scripts/servir.mjs` sirve `apps/web/dist` en `127.0.0.1` (origen que Ollama acepta por defecto y que el navegador
considera seguro para instalar la PWA). El instalador nativo se compila en GitHub Actions (`windows-latest`).


## PDF, estilos y grupos (v1.1)

- **PDF:** el archivo se guarda en SQLite como base64 en `attachment_data` (separado de `attachments` para que listar no lo cargue); así funciona igual en Windows, web y pruebas, y entra en las copias de seguridad. El texto de cada página (separadas por `\f`) va a `attachments.text` y al índice `attachments_fts`. Subrayados en `annotations` con rectángulos normalizados (0–1) respecto de la página. Se usa la versión «legacy» de pdf.js porque la moderna requiere funciones de JavaScript que aún no tienen todos los navegadores (falló en el Chromium de las pruebas).
- **Estilos CSL:** `packages/cite` carga el catálogo y los estilos incluidos de forma diferida (no pesan en el arranque). Los estilos dependientes se resuelven a su estilo padre. Los descargados se guardan en `csl_styles`. La salida HTML de citeproc no se inserta en la página: se convierte en segmentos con formato y se dibuja con React.
- **Grupos inteligentes:** reglas en `smart_groups.rules` (JSON validado con `parseSmartRules`); se evalúan en la interfaz sobre la biblioteca (`matchSmartGroup`), así siempre reflejan los datos actuales.
