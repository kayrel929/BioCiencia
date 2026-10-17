import { STUDY_FILTER_SOURCES } from "./studies.ts";
import { mergeWork, normalizeWork, workKeys, type SourceName, type Work } from "@biociencia/core";
import { SOURCE_LABELS, SourceError, type FreeSearchParams, type FreeSource } from "./http.ts";

/**
 * Búsqueda en varias fuentes a la vez. Las consultas van en paralelo; si una fuente falla,
 * las demás siguen y el error se informa (no se inventan resultados).
 * Un mismo artículo que aparece en varias fuentes se une en una sola ficha (DOI, PMID…).
 */

export interface UnifiedWork extends Work {
  /** Fuentes donde apareció, en orden */
  foundIn: SourceName[];
}

export interface SourceOutcome {
  source: SourceName;
  label: string;
  total: number;
  count: number;
  url: string | null;
  error: string | null;
  /** La fuente no se consultó (p. ej. no permite el filtro elegido) */
  skipped: string | null;
  costUsd?: number | null;
  remainingUsd?: number | null;
}

export interface UnifiedResult {
  works: UnifiedWork[];
  outcomes: SourceOutcome[];
  /** Suma de los totales informados (puede contar el mismo artículo varias veces) */
  totalReported: number;
}

/** Fuentes que no permiten filtrar por acceso abierto (su resultado no podría cumplir el filtro). */
const NO_OA_FILTER: SourceName[] = ["crossref"];

/** Une resultados intercalando por posición (1.º de cada fuente, luego 2.º…) para respetar la relevancia. */
export function mergeResults(lists: { source: SourceName; works: Work[] }[]): UnifiedWork[] {
  const out: UnifiedWork[] = [];
  const index = new Map<string, number>();
  const max = Math.max(0, ...lists.map((l) => l.works.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const w = l.works[i];
      if (!w) continue;
      const n = normalizeWork(w);
      const keys = workKeys(n).map((k) => `${k.kind}:${k.value}`);
      const at = keys.map((k) => index.get(k)).find((x) => x !== undefined);
      if (at === undefined) {
        const pos = out.push({ ...n, foundIn: [l.source] }) - 1;
        keys.forEach((k) => index.set(k, pos));
      } else {
        const prev = out[at]!;
        const merged = mergeWork(prev, n);
        out[at] = { ...merged, foundIn: prev.foundIn.includes(l.source) ? prev.foundIn : [...prev.foundIn, l.source] };
        workKeys(merged).forEach((k) => index.set(`${k.kind}:${k.value}`, at));
      }
    }
  }
  return out;
}

export async function searchSources(sources: FreeSource[], p: FreeSearchParams): Promise<UnifiedResult> {
  const outcomes: SourceOutcome[] = [];
  const lists: { source: SourceName; works: Work[] }[] = [];
  const runs = sources.map(async (s) => {
    const base: SourceOutcome = { source: s.id, label: SOURCE_LABELS[s.id] ?? s.id, total: 0, count: 0, url: null, error: null, skipped: null };
    if ((p.filters?.studyTypes?.length || p.filters?.method) && !(STUDY_FILTER_SOURCES as readonly string[]).includes(s.id)) {
      return { ...base, skipped: `${base.label} no permite filtrar por tipo de estudio ni por método` };
    }
    if (p.filters?.openAccess && NO_OA_FILTER.includes(s.id)) {
      return { ...base, skipped: `${base.label} no permite filtrar por acceso abierto` };
    }
    try {
      const r = await s.search(p);
      lists.push({ source: s.id, works: r.works });
      return { ...base, total: r.total, count: r.works.length, url: r.url, costUsd: r.costUsd ?? null, remainingUsd: r.remainingUsd ?? null };
    } catch (e) {
      return { ...base, error: e instanceof SourceError || e instanceof Error ? e.message : String(e) };
    }
  });
  for (const o of await Promise.all(runs)) outcomes.push(o);
  // Orden estable: el mismo que el de las fuentes pedidas
  const order = sources.map((s) => s.id);
  lists.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  return { works: mergeResults(lists), outcomes, totalReported: outcomes.reduce((a, o) => a + o.total, 0) };
}

/** OpenAlex dentro de la búsqueda combinada (es la única fuente con costo por consulta). */
export class OpenAlexSource implements FreeSource {
  readonly id = "openalex" as const;
  constructor(private readonly client: { searchWorks(p: import("./openalex.ts").SearchParams): Promise<import("./openalex.ts").SearchResult> }) {}
  async search(p: FreeSearchParams) {
    const r = await this.client.searchWorks({ text: p.text, mode: "keywords", filters: { ...p.filters }, sort: p.sort, page: p.page, perPage: p.perPage });
    return { source: "openalex" as const, works: r.works, total: r.total, url: r.url, costUsd: r.costUsd, remainingUsd: r.remainingUsd };
  }
}
