# Seguridad de BioCiencia

Revisión de la Fase 11 (2026-10-15). Describe qué protege la aplicación, cómo se comprobó y qué riesgos quedan.

## Principios

- **Local primero:** los datos viven en la computadora del usuario (SQLite). No hay servidor de BioCiencia ni cuentas.
- **Sin contraseñas guardadas:** la app no pide ni almacena contraseñas de servicios. La contraseña de una copia cifrada no se guarda en ningún lado.
- **Sin claves en el frontend:** las API usadas son públicas y gratuitas; no hay claves en el código (revisado con búsqueda de patrones en el repositorio y en el paquete compilado).
- **Consultas privadas:** solo se envía a cada API el texto de búsqueda y, si el usuario lo configura, su correo de contacto (lo piden OpenAlex, Crossref, PubMed y Unpaywall).

## Protecciones

| Riesgo | Protección | Prueba |
| --- | --- | --- |
| Robo de la copia de seguridad (incluye la llave privada de firma) | Copia cifrada opcional y recomendada: PBKDF2-SHA-256 (600 000 iteraciones) + AES-256-GCM, sal y vector aleatorios; contraseña mínima de 10 caracteres | `tests/security`, `tests/e2e/fase11.spec.ts` |
| Archivo cifrado manipulado | AES-GCM detecta cualquier cambio; iteraciones fuera de 100 000–10 000 000 se rechazan (evita bloquear la app) | `tests/security` |
| Datos sensibles en registros | `redact()` quita correos, `token=`, `api_key=`, encabezados `Authorization`, llaves largas y el nombre de usuario de rutas (`C:\Users\…`) antes de guardar el registro de sincronización | `tests/security` |
| Inyección de HTML/scripts (títulos o resúmenes maliciosos) | Todo texto se escapa al generar HTML y Word; React escapa por defecto; la única inserción de HTML (vista previa del editor) usa HTML ya escapado | `tests/security` |
| Scripts externos o en línea | CSP en la versión web compilada y en la app Windows: solo código propio, `object-src 'none'`, conexiones solo a las 8 API listadas (se añadió OpenCitations) | `tests/e2e/fase11.spec.ts` (verifica que un script inyectado no se ejecuta) |
| Inyección SQL | Todas las consultas usan parámetros; la búsqueda de texto completo convierte la entrada en términos entre comillas | `tests/security` |
| Archivos de referencias dañados o maliciosos | 500 archivos aleatorios y entradas patológicas de hasta 200 000 caracteres: sin fallos inesperados ni bloqueos | `tests/security` |
| Expresión regular de citas con tiempo cuadrático | **Encontrado en esta fase:** `[@` repetido 50 000 veces tardaba 4,4 s. Corregido (límite de longitud y sin `[` interno) | `tests/security` |
| Eventos de sincronización falsificados o alterados | Firma Ed25519 en cada evento; autor debe ser miembro con la misma llave; permisos por rol | `tests/two-nodes` |
| **Apropiación de un proyecto con una «creación» antedatada** | **Encontrado en esta fase:** un miembro con acceso a la carpeta (incluso lector) podía escribir otro evento de creación con fecha anterior, firmado con su llave, y quedar como administrador. Corregido: el identificador de cada proyecto compartido queda ligado a la llave de quien lo creó (80 bits de SHA-256 dentro del ULID); cualquier otra creación se rechaza. Los proyectos creados antes reciben un identificador nuevo al compartirlos | `tests/two-nodes` (la prueba falla sin la corrección: «Proyecto robado») |
| Rutas fuera de la carpeta de sincronización (app Windows) | Nombres validados (ULID) y tamaño máximo de 64 MB por archivo | pruebas Rust de `syncdir` |
| Escritura de archivos (app Windows) | Solo en la ruta elegida en el diálogo «Guardar como», con extensiones permitidas y escritura atómica; binarios hasta 50 MB | revisión de código, `cargo check` |

| Clave de API de Scopus (opcional, del propio usuario) | Se guarda solo en la base local, se envía únicamente a api.elsevier.com, no viaja en las copias de seguridad y se oculta en los registros (`apiKey=`) | `packages/storage/tests/own.test.ts` |

| IA que inventa referencias o citas | La IA solo recibe fuentes reales numeradas; los números que no existen se reemplazan por [?] y cada frase citada se busca en el texto de la fuente (verificación sin IA) | `packages/ai/tests`, `tests/e2e/fase7.spec.ts` |
| Envío de consultas privadas a un servicio de IA externo | Ollama/LM Studio locales por defecto; los servicios en la nube no se usan sin la casilla de autorización (prueba: cero llamadas); direcciones de proveedores fijas en el código y la CSP; la clave no viaja en las copias | `tests/e2e/fase7.spec.ts`, `packages/storage/tests/own.test.ts` |
| Acceso de otros equipos de la red al lanzador | `scripts/servir.mjs` escucha solo en 127.0.0.1, solo GET/HEAD y nunca sirve archivos fuera de `apps/web/dist` | prueba manual con curl (rutas `../` → 404) |

## Dependencias

- `npm audit`: **0 vulnerabilidades** (2026-10-15).
- `cargo audit` (base RustSec, 473 paquetes): **0 vulnerabilidades**; 2 avisos: `glib 0.18.5` (unsound, RUSTSEC-2024-0429) y `proc-macro-error` (sin mantenimiento, RUSTSEC-2024-0370). Ambos llegan con Tauri a través de GTK, que solo se usa en Linux; la app de Windows usa WebView2. Se revisará al actualizar Tauri.

## Riesgos conocidos (no resueltos)

- La **llave privada** se guarda sin cifrar dentro de la base de datos local (como hacen SSH o los navegadores sin contraseña maestra). Quien tenga acceso a su cuenta de Windows puede leerla. Protección recomendada: cuenta de Windows con contraseña y cifrado de disco (BitLocker).
- La **copia sin contraseña** sigue disponible (para quien no quiera cifrar); la pantalla advierte que contiene la llave privada.
- Un miembro con acceso a la carpeta compartida puede **llenarla de eventos inválidos** (se descartan, pero ocupan espacio). Solo comparta la carpeta con las personas del proyecto.
- La CSP de la versión web va en una etiqueta `<meta>`: `frame-ancestors` no se puede aplicar así. Al publicar la PWA (Fase 10) se configurará como encabezado del servidor.
- No se ha hecho una auditoría externa ni pruebas de penetración por terceros.
