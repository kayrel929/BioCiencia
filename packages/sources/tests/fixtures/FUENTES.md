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
| unpaywall-404.html | Unpaywall, DOI inexistente (404 en HTML) | e9639e3c…59b76237ab80 |

## Comportamiento comprobado en las APIs reales (2026-10-15)

- **Permiten llamadas desde el navegador (CORS):** Crossref, PubMed (E-utilities), Europe PMC, DOAJ, Unpaywall.
- **No lo permiten:** arXiv y CORE (la llamada falla desde el navegador). Quedan para la app de Windows (Fase 10).
- PubMed informa `x-ratelimit-limit: 3` (3 consultas por segundo sin clave).
- Crossref: filtros `from-pub-date`, `until-pub-date`, `type`; orden `is-referenced-by-count`. Errores 400 con `message[]`.
- Europe PMC: `PUB_YEAR:[a TO b]`, `OPEN_ACCESS:Y`, `sort=P_PDATE_D desc`, `page=N`.
- DOAJ: `bibjson.year:[a TO b]` en la consulta funciona; el parámetro `sort` y las consultas mal formadas pueden quedar sin respuesta (se aplica tiempo límite).
- Unpaywall responde 404 en HTML (no JSON) cuando el DOI no existe.
- SciELO no tiene una API de búsqueda JSON pública estable; sus revistas aparecen en Crossref, DOAJ y OpenAlex.
- Verificado también: `free full text[sb]` en PubMed (14 de 35 para «Stenocarpella maydis»), `sort=CITED desc` en Europe PMC y `sort=published&order=desc` en Crossref.
