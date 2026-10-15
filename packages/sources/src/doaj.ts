import { normalizeDoi, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, parseJson, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * DOAJ (https://doaj.org/api/docs) — gratuito; solo revistas de acceso abierto revisadas,
 * muchas latinoamericanas (SciELO). Verificado el 2026-10-15: el parámetro `sort` puede
 * dejar la consulta sin respuesta, por eso no se usa; el rango de años va dentro de la consulta.
 */
export const DOAJ_BASE = "https://doaj.org/api/search/articles";

/** DOAJ usa sintaxis de Elasticsearch: se quitan caracteres que romperían la consulta. */
export function doajQuery(text: string): string {
  return text.replace(/[\\/{}[\]^~:!()]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildDoajUrl(p: FreeSearchParams): string {
  let q = doajQuery(p.text);
  const { yearFrom, yearTo } = p.filters ?? {};
  if (yearFrom || yearTo) q = `(${q}) AND bibjson.year:[${yearFrom ?? 1800} TO ${yearTo ?? 3000}]`;
  const qs = new URLSearchParams({ page: String(Math.max(p.page ?? 1, 1)), pageSize: String(clampPerPage(p.perPage, 100)) });
  return `${DOAJ_BASE}/${encodeURIComponent(q)}?${qs}`;
}

export function parseDoajWork(r: any, fetchedAt: string): Work {
  const b = r.bibjson ?? {};
  const doi = normalizeDoi((b.identifier ?? []).find((i: any) => String(i.type).toLowerCase() === "doi")?.id ?? null);
  const full = (b.link ?? []).find((l: any) => l.type === "fulltext")?.url ?? null;
  const authors: AuthorRef[] = (b.author ?? []).map((a: any) => ({ name: a.name ?? "", orcid: a.orcid_id ? String(a.orcid_id).replace(/^https?:\/\/orcid\.org\//, "") : null })).filter((a: AuthorRef) => a.name);
  return {
    title: stripTags(b.title) || "(sin título)",
    authors,
    year: b.year ? Number(b.year) : null,
    venue: b.journal?.title ?? null,
    doi,
    abstract: stripTags(b.abstract) || null,
    keywords: b.keywords ?? [],
    type: "article",
    citedByCount: null,
    // DOAJ solo indexa revistas de acceso abierto
    isOpenAccess: true,
    oaUrl: full,
    landingUrl: r.id ? `https://doaj.org/article/${r.id}` : full,
    source: "doaj",
    fetchedAt,
  };
}

export class DoajClient implements FreeSource {
  readonly id = "doaj" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildDoajUrl(p);
    const body = parseJson("doaj", (await getText(this.http, "doaj", url, this.opts.timeoutMs ?? 15_000)).text);
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    return { source: "doaj", works: (body?.results ?? []).map((r: any) => parseDoajWork(r, at)), total: Number(body?.total ?? 0), url };
  }
}
