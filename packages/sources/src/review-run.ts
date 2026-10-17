import { buildStrategy, type ReviewQuestion, type SourceRun, type Work } from "@biociencia/core";
import { SOURCE_LABELS, SourceError, type FreeSearchParams, type FreeSource } from "./http.ts";
import { STUDY_FILTER_SOURCES } from "./studies.ts";
import { mergeResults, type UnifiedWork } from "./unified.ts";

/** Qué estrategia usa cada fuente: booleana con campos (PubMed, Europe PMC) o simplificada (Crossref, DOAJ). */
export const REVIEW_ENGINE: Record<string, "pubmed" | "europepmc" | "simple"> = { pubmed: "pubmed", europepmc: "europepmc", crossref: "simple", doaj: "simple" };

const PAGE = 100;
const idOf = (w: Work) => w.doi ?? (w.pmid ? `pmid:${w.pmid}` : `t:${w.title.toLowerCase()}|${w.year ?? ""}`);

export interface ReviewSearchOptions {
  filters?: FreeSearchParams["filters"];
  /** Máximo de registros a traer de cada fuente (en páginas de 100) */
  maxPerSource?: number;
  onProgress?: (msg: string) => void;
  /** Para pruebas: espera sin tiempo real */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Ejecuta la estrategia en cada fuente, página por página, y une los repetidos.
 * Devuelve lo necesario para el diagrama PRISMA: total informado y registros recuperados por fuente.
 */
export async function runReviewSearch(sources: FreeSource[], q: ReviewQuestion, opts: ReviewSearchOptions = {}): Promise<{ runs: SourceRun[]; works: UnifiedWork[] }> {
  const max = Math.min(Math.max(opts.maxPerSource ?? 100, 1), 1000);
  const runs: SourceRun[] = [];
  const lists: { source: FreeSource["id"]; works: Work[] }[] = [];
  const studyFilter = !!(opts.filters?.studyTypes?.length || opts.filters?.method);
  await Promise.all(
    sources.map(async (s) => {
      const engine = REVIEW_ENGINE[s.id];
      const label = SOURCE_LABELS[s.id] ?? s.id;
      const query = engine ? buildStrategy(q, engine) : "";
      const run: SourceRun = { source: s.id, label, found: 0, retrieved: 0, query, error: null, skipped: null };
      runs.push(run);
      if (!engine) return void (run.skipped = "Fuente no disponible para revisiones");
      if (!query) return void (run.skipped = "La estrategia está vacía");
      if (studyFilter && !(STUDY_FILTER_SOURCES as readonly string[]).includes(s.id)) return void (run.skipped = `${label} no permite filtrar por tipo de estudio ni por método`);
      if (opts.filters?.openAccess && s.id === "crossref") return void (run.skipped = "Crossref no permite filtrar por acceso abierto");
      const works: Work[] = [];
      const seen = new Set<string>();
      try {
        for (let page = 1; works.length < max; page++) {
          opts.onProgress?.(`${label}: página ${page}…`);
          // Tamaño de página constante: las API calculan el desplazamiento como (página − 1) × tamaño
          const params = { text: query, filters: opts.filters, page, perPage: PAGE, sort: "relevance" as const };
          // Un reintento tras una pausa si la fuente bloqueó por exceso de consultas o hubo un corte
          const r = await s.search(params).catch(async (e) => {
            if (e instanceof SourceError && (e.status === null || e.status === 429 || (e.status ?? 0) >= 500)) {
              await (opts.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms))))(2000);
              return s.search(params);
            }
            throw e;
          });
          run.found = r.total;
          // Protección: si una página no trae nada nuevo (fuente que ignora la paginación), se detiene
          const fresh = r.works.filter((w) => !seen.has(idOf(w)));
          fresh.forEach((w) => seen.add(idOf(w)));
          works.push(...fresh.slice(0, max - works.length));
          if (!fresh.length || works.length >= r.total) break;
        }
      } catch (e) {
        run.error = e instanceof Error ? e.message : String(e);
      }
      run.retrieved = works.length;
      lists.push({ source: s.id, works });
    }),
  );
  // Orden estable de las fuentes (el de la lista recibida)
  const order = sources.map((s) => s.id);
  runs.sort((a, b) => order.indexOf(a.source as FreeSource["id"]) - order.indexOf(b.source as FreeSource["id"]));
  lists.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  return { runs, works: mergeResults(lists) };
}
