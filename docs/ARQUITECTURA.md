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
| Sincronización (F5) | `packages/sync` (futuro) | Eventos firmados + Syncthing; luego iroh | Archivo de intercambio o nodo de escritorio |

## Base de datos

- Esquema en `packages/storage/src/migrations.ts`. Las migraciones nunca se editan; se agregan.
- Publicaciones: tabla `works` + `work_ids` (DOI, PMID, OpenAlex, arXiv, titlehash) para reconocer duplicados.
- `sources_log` registra cada fuente que aportó datos y cuándo.
- `works_fts`: índice FTS5 con `remove_diacritics 2` (busca «biologico» y encuentra «biológico»).
- Borrados lógicos (`deleted = 1`) para no perder historial y para la sincronización futura.

## Sincronización (diseño, Fase 5)

- Cada cambio genera un **evento** (ULID, dispositivo, autor, proyecto, entidad, operación, datos, HLC, firma Ed25519).
- Los eventos se exportan a archivos por dispositivo y día; nunca se copia el `.db` abierto.
- Conflictos: último-escritor-gana por campo según HLC; conjuntos con marcas de borrado; CRDT (Yjs) para manuscritos.
- Permisos: altas y roles son eventos firmados por un administrador; cada nodo verifica antes de aplicar.
- Transporte v1: carpeta por proyecto sincronizada con Syncthing (descubrimiento LAN/global, NAT, relays, TLS).

## Seguridad

- Sin contraseñas en texto plano: la identidad es local; en la Fase 6 se añaden llaves Ed25519 guardadas en el Administrador de credenciales de Windows / WebCrypto.
- Claves de API del usuario nunca en el código; guardadas en el sistema (Windows) y enviadas solo a su proveedor.
- La consulta FTS se construye escapando cada palabra (`toFtsQuery`); todo el SQL usa parámetros.
- CSP restrictiva en Tauri; los enlaces externos se abren en el navegador del sistema.
