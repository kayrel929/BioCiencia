import { useApp, useAsync } from "./context.tsx";

/**
 * Idioma de la interfaz: español (por defecto) o inglés, estilo Consensus.
 * La elección se guarda en esta computadora. Las pantallas que aún no tienen
 * traducción quedan en español mientras se van adaptando.
 */

export type Lang = "es" | "en";
export const LANG_KEY = "ui_language";

/** Cada mensaje: [español, inglés]. */
const DICT: Record<string, [string, string]> = {
  // Menú lateral
  "nav.home": ["Inicio", "Home"],
  "nav.search": ["Buscador", "Search"],
  "nav.review": ["Revisión de literatura", "Literature review"],
  "nav.ai": ["Análisis con IA", "AI analysis"],
  "nav.library": ["Biblioteca", "Library"],
  "nav.discovery": ["Descubrimiento", "Discovery"],
  "nav.researchers": ["Investigadores", "Researchers"],
  "nav.sync": ["Sincronización", "Sync"],
  "nav.settings": ["Configuración", "Settings"],
  "nav.help": ["Ayuda", "Help"],
  "nav.group1": ["Investigar", "Research"],
  "nav.group2": ["Organizar", "Organize"],
  "nav.group3": ["Colaborar", "Collaborate"],
  "nav.theme": ["Modo oscuro", "Dark mode"],
  "nav.light": ["Modo claro", "Light mode"],

  // Inicio estilo Consensus
  "home.title": ["¿Qué dice la literatura?", "What does the literature say?"],
  "home.slogan": ["Pregunte en sus propias palabras: BioCiencia busca en las bases de datos reales y le muestra la evidencia, artículo por artículo.",
    "Ask in your own words: BioCiencia searches the real databases and shows you the evidence, paper by paper."],
  "home.placeholder": ["Pregunte, por ejemplo: ¿la rotación de cultivos reduce la pudrición de mazorca?",
    "Ask, for example: does crop rotation reduce ear rot?"],
  "home_button": ["Buscar", "Search"],
  "home.try": ["Pruebe con:", "Try:"],
  "home.ex1": ["¿La rotación de cultivos reduce la pudrición de mazorca?", "Does crop rotation reduce corn ear rot?"],
  "home.ex2": ["¿Los fertilizantes foliares aumentan el rendimiento del maíz?", "Do foliar fertilizers raise maize yield?"],
  "home.ex3": ["¿La actividad física mejora la glucemia en diabetes tipo 2?", "Does exercise improve blood sugar in type 2 diabetes?"],
  "home.cardLibrary": ["publicaciones en su biblioteca", "items in your library"],
  "home.cardSearches": ["Búsquedas recientes", "Recent searches"],
  "home.cardEmpty": ["Aún no hay búsquedas guardadas.", "No saved searches yet."],
  "home.session": ["Sesión de", "Signed in as"],
  "home.sessionTag": ["Sus datos se guardan en este equipo.", "Your data is stored on this computer."],

  // Consensus: panel
  "cs.about": ["¿Qué dice la literatura sobre:", "What does the literature say about:"],
  "cs.runFirst": ["Sintetizar con IA", "Synthesize with AI"],
  "cs.runAgain": ["Repetir análisis", "Re-run analysis"],
  "cs.needsAi": ["La síntesis automática y los veredictos necesitan su propia IA (privada con Ollama, o un servicio en la nube con su clave).",
    "Automatic synthesis and verdicts need your own AI (private with Ollama, or a cloud service with your key)."],
  "cs.noModel": ["Todavía no definió un modelo.", "No model is configured yet."],
  "cs.settings": ["Configuración de IA", "AI settings"],
  "cs.noAbstract": ["Ninguno de los resultados muestra todavía un resumen suficientemente largo para evaluar. Abra «Leer resumen completo» de un resultado o pruebe otra pregunta.",
    "None of the results show a long-enough abstract yet. Open a result's full abstract or try another question."],
  "cs.synthesis": ["Respuesta del consenso", "Consensus answer"],
  "cs.followAnswer": ["Respuesta a su seguimiento", "Answer to your follow-up"],
  "cs.askFollow": ["Pregúntele algo más a estos resultados…", "Ask these results something else…"],
  "cs.ask": ["Preguntar", "Ask"],
  "cs.claims": ["Comprobación de cada afirmación", "Check of each claim"],
  "cs.table": ["Tabla de síntesis", "Synthesis table"],
  "cs.tablePaper": ["Artículo", "Paper"],
  "cs.tableVerdict": ["Veredicto", "Verdict"],
  "cs.tableQuote": ["Frase del resumen que lo respalda", "Quote from the abstract that supports it"],
  "cs.related": ["Preguntas relacionadas:", "Related questions:"],
  "cs.notFound": ["La frase NO aparece en la fuente", "The quote is NOT in the source"],
  "cs.verified": ["Frase verificada", "Quote verified"],
  "cs.noQuote": ["Sin frase citada", "No quoted sentence"],
  "cs.brokenRef": ["Cita a una fuente que no existe", "Cites a source that does not exist"],
  "cs.biblioteca": ["biblioteca", "library"],
  "cs.obs": ["estudios observacionales", "observational studies"],
  "cs.reports": ["reportes u opinión", "reports or opinion"],
  "cs.retracted": ["con retractación", "retracted"],
  "cs.withAbstract": ["con resumen visible (la síntesis usa los resúmenes; sin IA).", "have a visible abstract (the synthesis uses the abstracts; no AI)."],
  "cs.level1": ["metaanálisis", "meta-analyses"],
  "cs.level2": ["revisiones sistemáticas", "systematic reviews"],
  "cs.level3": ["experimentos controlados", "controlled experiments"],
  "cs.meterFoot": [" — solo artículos con frase comprobada en su resumen.", " — only papers with a quote verified in their abstract."],
  "cs.searchTipClick": ["Buscar:", "Search:"],

  // Veredictos
  "v.apoya": ["Apoya", "Supports"],
  "v.refuta": ["Refuta", "Refutes"],
  "v.mixto": ["Resultados mixtos", "Mixed results"],
  "v.no_relacionado": ["No trata el tema", "Not about this"],
  "v.no_verificado": ["Sin cita verificable", "No verifiable quote"],
  "v.sin_respuesta": ["Sin respuesta del modelo", "No model response"],

  // Ficha de resultado
  "wi.quoteChecked": [" — ✓ frase comprobada en el resumen", " — ✓ quote verified in the abstract"],
  "wi.quoteNot": [" — ✗ frase NO encontrada en el resumen", " — ✗ quote NOT found in the abstract"],
  "wi.openAccess": ["Acceso abierto", "Open access"],
  "wi.noDoi": ["Sin DOI", "No DOI"],
  "wi.cites": ["citas", "citations"],
  "wi.open": ["Abrir artículo", "Open paper"],
  "wi.oaPdf": ["PDF de acceso abierto", "Open-access PDF"],
  "wi.requestArticle": ["Solicitar artículo completo", "Request the full paper"],

  // Acceso abierto (Unpaywall automático)
  "oa.checking": ["Comprobando si hay copia legal gratuita…", "Checking for a free legal copy…"],
  "oa.pdfFree": ["PDF gratis", "Free PDF"],
  "oa.pdfFreeTip": ["Abrir la copia legal gratuita (Unpaywall)", "Open the free legal copy (Unpaywall)"],
  "oa.download": ["Guardar PDF", "Save PDF"],
  "oa.downloadTip": ["Descargar el PDF legal y guardarlo en su biblioteca", "Download the legal PDF and save it to your library"],
  "oa.saving": ["Guardando…", "Saving…"],
  "oa.saved": ["PDF guardado en su biblioteca.", "PDF saved to your library."],
  "oa.failed": ["No se pudo guardar automáticamente; use «PDF gratis» para abrirlo y guardarlo usted.", "Could not save automatically; use “Free PDF” to open and save it yourself."],

  // Buscador
  "s.title": ["Buscador científico", "Scientific search"],
  "s.subtitle": ["Busca a la vez en Europe PMC, PubMed, Crossref, DOAJ y, si lo elige, OpenAlex. Los resultados repetidos se unen en una sola ficha.",
    "Search Europe PMC, PubMed, Crossref, DOAJ and (optionally) OpenAlex at once. Duplicate results are merged into one card."],
  "s.modeKeywords": ["Pregunta o palabras clave", "Question or keywords"],
  "s.modeTitle": ["Título", "Title"],
  "s.modeAuthor": ["Autor", "Author"],
  "s.modeJournal": ["Revista", "Journal"],
  "s.phKeywords": ["Ej.: ¿Qué microorganismos controlan Ralstonia solanacearum? · o un DOI", "E.g.: What microorganisms control Ralstonia solanacearum? · or a DOI"],
  "s.phTitle": ["Palabras del título", "Words from the title"],
  "s.phAuthor": ["Nombre del autor", "Author's name"],
  "s.phJournal": ["Nombre de la revista", "Journal name"],
  "s.searching": ["Buscando…", "Searching…"],
  "s.sources": ["Fuentes", "Sources"],
  "s.sourcesShort": ["fuentes", "sources"],
  "s.filters": ["Filtros", "Filters"],
  "s.sortBy": ["Ordenar por", "Sort by"],
  "s.rel": ["Relevancia", "Relevance"],
  "s.cited": ["Más citados", "Most cited"],
  "s.recent": ["Más recientes", "Most recent"],
  "s.byEvidence": ["Mejor evidencia primero", "Best evidence first"],
  "s.byEvidenceTip": ["Reordena los resultados ya obtenidos: metaanálisis y revisiones sistemáticas primero", "Re-sorts the results already fetched: meta-analyses and systematic reviews first"],
  "s.results": ["resultados", "results"],
  "s.combinedResults": ["resultados combinados", "combined results"],
  "s.savedResults": ["resultados guardados", "saved results"],
  "s.savedSearch": ["Búsqueda guardada · mostrada sin conexión, sin costo", "Saved search · shown offline, at no cost"],
  "s.sentPrefix": ["Las fuentes buscan por palabras; se envió:", "The sources search by words; sent:"],
  "s.export": ["Exportar estos resultados", "Export these results"],
  "s.none": ["Sin resultados con estos criterios.", "No results with these criteria."],
  "s.inLibrary": ["En su biblioteca", "In your library"],
  "s.saveLibrary": ["Guardar en biblioteca", "Save to library"],
  "s.loading": ["Cargando…", "Loading…"],
  "s.loadMore": ["Cargar más resultados", "Load more results"],
  "s.history": ["Historial de búsquedas", "Search history"],
  "s.historySub": ["Al abrir una búsqueda guardada se muestran sus resultados desde su equipo, sin internet ni costo.", "Opening a saved search shows its results from your computer, with no internet and no cost."],
  "s.noSearches": ["Todavía no hay búsquedas.", "No searches yet."],
  "s.tableQ": ["Consulta", "Query"],
  "s.tableR": ["Resultados", "Results"],
  "s.tableD": ["Fecha", "Date"],
  "s.tableS": ["Acciones", "Actions"],
  "s.delete": ["Borrar", "Delete"],
  "s.deleteFrom": ["Borrar del historial: ", "Delete from history: "],
};

/** Traduce una clave. Si el idioma es español o la clave no existe, devuelve el texto original. */
export function tr(lang: Lang, key: string): string {
  const d = DICT[key];
  if (!d) return key;
  return lang === "en" ? d[1] : d[0];
}

/** Lang actual (con su lista de claves) para componentes que ya guardan el idioma. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => Promise<void>; t: (key: string) => string } {
  const { repo, refresh } = useApp();
  const stored = useAsync(async () => ((await repo.getSetting(LANG_KEY)) as Lang) || "es", []);
  const lang = (stored.data ?? "es") as Lang;
  return {
    lang,
    setLang: async (l) => {
      await repo.setSetting(LANG_KEY, l);
      window.location.reload();
    },
    t: (key) => tr(lang, key),
  };
}
