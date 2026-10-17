# Respuestas reales grabadas (Fase 3b)

Grabadas el 2026-10-15 desde el navegador del usuario (la nube de desarrollo no tiene acceso a estas APIs).
Cada archivo es la respuesta **exacta** del servidor; se verificó con SHA-256 que no cambió un solo byte.

| Archivo | Consulta | SHA-256 |
| --- | --- | --- |
| crossref-search-stenocarpella.json | `api.crossref.org/works?rows=3&query=Stenocarpella+maydis&select=…` | 80dc6855…d1d79323 |
| crossref-error-400.json | Crossref con un `select` inválido (error 400 real) | d9a4f356…69c4c709 |
| pubmed-esearch-stenocarpella.json | `eutils…/esearch.fcgi?db=pubmed&term=Stenocarpella+maydis&retmax=3` | d4a886ef…93174e72 |
| pubmed-efetch-41141834.xml | `eutils…/efetch.fcgi?db=pubmed&id=41141834&retmode=xml` | 12c483af…6641d3acd |
| europepmc-search-stenocarpella.json | `ebi.ac.uk/europepmc/…/search?query=Stenocarpella maydis&pageSize=2&resultType=core` | eff84ee3…6326b57f |
| doaj-search-stenocarpella.json | `doaj.org/api/search/articles/Stenocarpella maydis?pageSize=2` | 7c1156b6…91a982c3 |
| unpaywall-oa-fpls.json | Unpaywall, DOI 10.3389/fpls.2014.00715 (oro, acceso abierto) | 8879f267…9aa005b115 |
| unpaywall-bronze-php.json | Unpaywall, DOI 10.1094/php-06-23-0060-rs (bronce) | bf2b4398…9b9773247 |
| unpaywall-closed-annurev.json | Unpaywall, DOI 10.1146/annurev-phyto-081211-173000 (cerrado) | d17b2131…b967e2f568f2 |
| unpaywall-oa-vmi.json | Unpaywall, DOI 10.1155/vmi/4160516 (oro) | e90b8633…5884f206 |
| orcid-personal-carberry.json | `pub.orcid.org/v3.0/0000-0002-1825-0097/personal-details` (cuenta de demostración oficial de ORCID) | 2ec2d77c…4b32744b |
| orcid-works-carberry.json | `pub.orcid.org/v3.0/0000-0002-1825-0097/works` | dfd93ef5…5e664480 |
| crossref-dois-2.json | Crossref `filter=doi:…,doi:…` (2 DOI) | 0d545f93…7f7dec5d |
| crossref-dois-carberry.json | Crossref con los 6 DOI del registro de demostración | 8963224d…7e025f4e3 |
| unpaywall-404.html | Unpaywall, DOI inexistente (404 en HTML) | e9639e3c…59b76237ab80 |
| openalex-biblio-ijms12095522.json | OpenAlex, DOI 10.3390/ijms12095522, campos `id` y `biblio` (Fase 8: volumen, número y páginas) | f7a36214…dbca1b28 |
| europepmc-references-25566289.json | Europe PMC `MED/25566289/references?pageSize=3` (red de citas) | c473ed1e…c242b64ca |
| europepmc-citations-25566289.json | Europe PMC `MED/25566289/citations?pageSize=3` | 4cf1cd13…fda178f1941df6d0 |
| opencitations-citations-bj36068.json | OpenCitations `index/v2/citations/doi:10.14393/bj-v33n1a2017-36068` | 9676500a…acebe178 |
| crossref-dois-citantes-bj36068.json | Crossref `filter=doi:…` con los 2 DOI que citan el anterior | c2542e0d…56a3ecd |
| opencitations-citations-vmi4160516.json | OpenCitations, DOI sin citas registradas (respuesta real `[]`) | 4f53cda1…1202b945 |
| europepmc-keyword-null-30832079.json | Europe PMC `EXT_ID:30832079 AND SRC:MED` (palabra clave `null` real) | 5ae27354…3f87f299 |
| europepmc-core-autores-correo-38117317.json | Europe PMC `DOI:"10.1007/s00299-023-03114-6"`, `resultType=core` (correos de 2 autores en la afiliación) | a6404a3c…bd945d9e2b4b55 |
| crossref-dois-retraccion-wakefield.json | Crossref `filter=doi:10.1016/s0140-6736(97)11096-0,doi:10.1007/s00299-023-03114-6` con `select=…,updated-by` (retractación de Retraction Watch) | ea58df45…3fc8631 |
| europepmc-retractados-wakefield.json | Europe PMC `(DOI:… OR DOI:…) AND PUB_TYPE:"Retracted Publication"`, `resultType=lite` | a9e8a060…8204c4b |
| ../../../../tests/e2e/fixtures/zootaxa.csl | Estilo CSL «Zootaxa» del repositorio oficial, commit 6ba2e9c6 (descargado desde el navegador del usuario, mismo hash) | d8c86f8c…fe8327bc1 |

## Comportamiento comprobado en las APIs reales (2026-10-15)

- **Permiten llamadas desde el navegador (CORS):** Crossref, PubMed (E-utilities), Europe PMC, DOAJ, Unpaywall, OpenAlex, ORCID, OpenCitations y **OpenAIRE** (comprobado el 2026-10-17: responde `access-control-allow-origin` con el origen de la app).
- **No lo permiten:** arXiv, Semantic Scholar y CORE. Semantic Scholar además limita las consultas seguidas (429 sin cabeceras CORS, el navegador lo ve como «error de conexión»). **Solución adoptada el 2026-10-17:** puentes locales en `scripts/servir.mjs` (`/api/s2` y `/api/arxiv`) que consultan desde esta computadora; si el puente no está (modo desarrollo) se intenta directo y se avisa. El mismo mecanismo se usa para **OpenAI** (`/api/openai`, añadido el 2026-10-17), que tampoco permite CORS: sin él, una clave de OpenAI correcta fallaba con «No se pudo conectar».
- **CORE** (`api.core.ac.uk/v3/search/works`, comprobado el 2026-10-17): sí permite CORS y responde sin clave, pero el servicio informa `x-ratelimit-limit: 10` y **gasta 2 unidades por consulta**; a las pocas consultas responde 429 con `x-ratelimit-remaining: 0` y sigue bloqueado tras 70 s. Su formulario de clave (enlazado desde su FAQ) responde **404** (`/api-keys/register`, `/api-keys`, `/services/api/register`, `/register`): hoy no hay clave gratuita obtenible. Descartado por no ser fiable de forma automática; su contenido llega por OpenAIRE.
- **CNKI** (2026-10-17): `robots.txt` = `Disallow: /` para todos los agentes; de pago (suscripción/institucional) y sin API pública. **eLIBRARY.RU** (2026-10-17): su `robots.txt` prohíbe `querybox.asp`, `author_info.asp`, `author_items.asp`, `cit_items.asp`, `refs.asp`, `title_items.asp` y `*.htm`; sus páginas exigen cuenta («недостаточно прав») y su servicio de datos es por acuerdo. Alternativas libres también bloqueadas: CyberLeninka (`Disallow: /api/` en su robots), ChinaXiv (403, en mantenimiento) y SciEngine (bloquea por nombre a los agentes automáticos).
- **arXiv** (`export.arxiv.org/api/query`, comprobado el 2026-10-17): `search_query` con `all:palabra` unidas con `AND`, rango `submittedDate:[AAAAMMDDhhmm TO AAAAMMDDhhmm]`, `start`/`max_results`, `sortBy=relevance`; responde Atom (XML), total en `opensearch:totalResults`, DOI en `<arxiv:doi>` y revista en `<arxiv:journal_ref>`. Pide no hacer más de una consulta cada 3 segundos.
- **OpenAIRE** (`api.openaire.eu/search/publications`, comprobado el 2026-10-17): `keywords=…` une las palabras con Y, `format=json`, `size` (máximo 50), `page`, `fromDateAccepted`/`toDateAccepted` (AAAA-MM-DD), `OA=true` y `sortBy=popularity,descending`. El total va en `response.header.total.$`; la revista en `children.result[].instance.hostedby.@name`; los nombres de autor pueden venir con «null » delante («null Pratibha Sharma») y el PMID de `pid` puede ser número.
- PubMed informa `x-ratelimit-limit: 3` (3 consultas por segundo sin clave).
- Crossref: filtros `from-pub-date`, `until-pub-date`, `type`; orden `is-referenced-by-count`. Errores 400 con `message[]`.
- Europe PMC: `PUB_YEAR:[a TO b]`, `OPEN_ACCESS:Y`, `sort=P_PDATE_D desc`. **El parámetro `page` se ignora** (la página 1 y la 2 devolvían lo mismo): se pagina con `cursorMark` (`*` y luego `nextCursorMark`). Verificado: 100 + 5 = 105 únicos de 105.
- DOAJ: `bibjson.year:[a TO b]` en la consulta funciona; el parámetro `sort` y las consultas mal formadas pueden quedar sin respuesta (se aplica tiempo límite).
- Unpaywall responde 404 en HTML (no JSON) cuando el DOI no existe.
- SciELO no tiene una API de búsqueda JSON pública estable; sus revistas aparecen en Crossref, DOAJ y OpenAlex.
- Verificado también: `free full text[sb]` en PubMed (14 de 35 para «Stenocarpella maydis»), `sort=CITED desc` en Europe PMC y `sort=published&order=desc` en Crossref.
- ORCID público (`pub.orcid.org/v3.0`): permite llamadas desde el navegador, sin clave; 404 en JSON si el ORCID no existe. Crossref acepta varios `doi:` en un mismo `filter`. El filtro `orcid:` de Crossref NO es fiable (el ORCID de demostración devuelve 3550 trabajos ajenos), por eso no se usa.
- **Red de citas y revisión (2026-10-15):** Europe PMC `/{fuente}/{id}/references` y `/citations` y OpenCitations `index/v2/references|citations/doi:…` permiten llamadas desde el navegador. OpenCitations solo da identificadores; se completan con Crossref (`filter=doi:…`, 20 por consulta).
- Tipo de estudio: PubMed `[pt]` (meta-analysis, systematic review, review, randomized controlled trial, clinical trial, observational study, case reports, practice guideline) y Europe PMC `PUB_TYPE:"…"`; campos `"término"[tiab]`, `TITLE_ABS:"término"` y truncamiento `resist*[tiab]` / `TITLE_ABS:resist*` aceptados. Con «maize»: PubMed 106 251 → 7 y Europe PMC 190 778 → 54 al combinar metaanálisis + ensayo de campo.
- **Límites de uso:** Crossref y PubMed bloquean por un momento las consultas muy seguidas y el navegador lo ve como «error de conexión» (sin cabeceras CORS). Por eso hay pausa entre lotes de Crossref, PubMed espacia sus llamadas (≥ 400 ms) y la revisión reintenta una vez.
- Europe PMC puede devolver `null` dentro de `keywordList.keyword` (p. ej. PMID 30832079); se descarta.
- **Correo del autor (2026-10-15):** con `resultType=core`, Europe PMC incluye la afiliación de cada autor y a veces el correo dentro de ella («… India. autor@inst.gov.in.», con punto final). En 25 artículos de 2023 sobre *Meloidogyne*, 4 traían correo. No hay garantía: cuando falta, se avisa y el usuario lo busca en la página del artículo.
- **Estilos CSL:** `raw.githubusercontent.com/citation-style-language/styles/<commit>/<id>.csl` permite descargas desde el navegador (CORS) y devuelve el archivo idéntico al del repositorio (SHA-256 comprobado con Zootaxa).
- **Retracciones (2026-10-15):** Crossref devuelve `updated-by` (también con `select`) con los avisos de Retraction Watch (`type`: retraction, correction, expression_of_concern…; `source`: retraction-watch, con fecha y DOI del aviso). Europe PMC acepta `PUB_TYPE:"Retracted Publication"` combinado con varios `DOI:"…"` unidos por `OR`; en `resultType=lite` el tipo llega como texto (`pubType: "retracted publication; …"`).
