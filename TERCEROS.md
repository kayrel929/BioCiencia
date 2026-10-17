# Componentes de terceros

BioCiencia (licencia MIT) incluye o descarga estos componentes libres. Sus licencias se respetan tal como se indica.

| Componente | Uso | Licencia |
| --- | --- | --- |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist` 6.3.289), Mozilla | Mostrar PDF, capa de texto para subrayar, extraer texto | Apache 2.0 |
| [citeproc-js](https://github.com/Juris-M/citeproc-js) (`citeproc` 2.4.63), Frank Bennett | Dar formato a citas y bibliografías CSL | CPAL 1.0 o AGPL 3.0 (BioCiencia lo usa bajo CPAL 1.0, sin modificarlo) |
| [Estilos CSL](https://github.com/citation-style-language/styles), proyecto Citation Style Language — https://citationstyles.org/ | 41 estilos incluidos en `packages/cite/src/styles`, catálogo de 10 865 y descarga de los demás (commit 6ba2e9c6) | CC BY-SA 3.0; se conservan sin cambios los autores y colaboradores de cada estilo |
| [Traducciones CSL (locales)](https://github.com/citation-style-language/locales) | 10 idiomas en `packages/cite/src/locales` | CC BY-SA 3.0 |
| [SQLite](https://sqlite.org) y sqlite-wasm | Base de datos local | Dominio público |
| React, React Router, Vite, Tauri | Interfaz y aplicación | MIT / MIT o Apache 2.0 |

El catálogo `packages/cite/src/catalog.json` se genera con `scripts/csl-catalogo.mjs` a partir de los repositorios oficiales.
