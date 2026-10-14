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
