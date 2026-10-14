# Análisis funcional de referencia: Consensus (consensus.app)

Informe completo con diagramas (en línea): «Análisis técnico de Consensus con REA».
Se estudiaron solo comunicaciones de la sesión propia del usuario y la interfaz pública.
No se leyó código JavaScript, no se reprodujeron peticiones ni se tocaron credenciales.
BioCiencia no reutiliza código, nombres, logotipos ni diseño de Consensus.

## Herramientas REA usadas

`list_browser_targets`, `capture_web_screenshot`, `inspect_web_page`, `observe_web_session`,
`inspect_web_network_capture` (HAR sanitizado, 133 peticiones) e `inspect_analysis_view`
(vista `api-surface`).

## Patrones verificados y su adaptación

| Patrón en Consensus | Evidencia | En BioCiencia |
| --- | --- | --- |
| Cada pregunta es un hilo con interacciones | `POST /api/threads/{id}/` | «Investigación» con consultas sucesivas, guardada localmente |
| Agente por etapas visibles | 9 nodos en un stream SSE | Mismas etapas con conteos reales (Fase 7) |
| Paneles pedidos por separado | `papers`, `yes_no`, `related_search_queries` | Resultados, postura y preguntas sugeridas independientes |
| Filtro estricto antes de leer | 1.262.982 → 26 → 20 | Reordenamiento + verificador con umbral |
| Insignias de calidad | tipo de estudio, cuartil SCImago, retractado | Mismas ideas con fuentes abiertas y fecha |
| Citas generadas en el cliente | evento `Paper Cite` sin petición | citeproc + CSL sin internet |
| ID estable por artículo | hash de 32 hex | ID local + `work_ids` (DOI normalizado, PMID, OpenAlex, arXiv) |

## Limitaciones observadas en Consensus que BioCiencia resuelve

- Búsqueda por autor sin desambiguar (mezcla homónimos) → ORCID / ID de autor de OpenAlex.
- Sin funcionamiento sin conexión ni datos locales → local-first.
- Sin colaboración P2P, editor ni estadística → Fases 5–9.
