import { normalizeDoi, normalizePmid, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, parseJson, stripTags, SourceError, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Semantic Scholar (API Graph: https://api.semanticscholar.org/graph/v1) — gratuita y sin clave
 * para uso moderado. Da el número de citas de un artículo (y las citas «influyentes»), que es otra
 * visión distinta de la de OpenCitations/Europe PMC. Verificado el 2026-10-17 desde esta computadora.
 *
 * Límite: sin clave, la API limita las consultas muy seguidas (error 429). Por eso BioCiencia la
 * consulta solo cuando el usuario lo pide, no en cada pantalla.
 */
export const S2_BASE = "https://api.semanticscholar.org/graph/v1";

export interface S2Paper {
  paperId: string;
  citationCount: number | null;
  /** Citas que la propia Semantic Scholar marca como más influyentes */
  influentialCitationCount: number | null;
  year: number | null;
  url: string;
}

/** Lee la respuesta de /paper/DOI:… (devuelve null si no viene el identificador). */
export function parseS2Paper(body: any): S2Paper | null {
  const id = body?.paperId;
  if (!id) return null;
  return {
    paperId: String(id),
    citationCount: typeof body.citationCount === "number" ? body.citationCount : null,
    influentialCitationCount: typeof body.influentialCitationCount === "number" ? body.influentialCitationCount : null,
    year: typeof body.year === "number" ? body.year : null,
    url: `https://www.semanticscholar.org/paper/${id}`,
  };
}

export class SemanticScholarClient {
  constructor(private readonly http: HttpGet, private readonly opts: { timeoutMs?: number } = {}) {}

  /** Citas en Semantic Scholar de un artículo, buscado por su DOI. Devuelve null si no está indexado. */
  async byDoi(doiInput: string): Promise<S2Paper | null> {
    const doi = normalizeDoi(doiInput ?? null);
    if (!doi) throw new SourceError("semanticscholar", "Se necesita el DOI del artículo para consultarlo en Semantic Scholar.", null);
    const fields = "paperId,citationCount,influentialCitationCount,year";
    const url = `${S2_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=${fields}`;
    const res = await getText(this.http, "semanticscholar", url, this.opts.timeoutMs ?? 20_000);
    if (res.status === 404) return null;
    return parseS2Paper(parseJson("semanticscholar", res.text));
  }
}

// ---------------- Búsqueda (como origen de búsqueda, junto a OpenAlex, PubMed, etc.) ----------------

/** Campos que se piden a la búsqueda. Se evitan los pesados (abstract) para no fallar por campos no admitidos. */
export const S2_SEARCH_FIELDS = "title,year,venue,externalIds,authors,citationCount,publicationTypes,openAccessPdf,publicationDate";

export function buildS2SearchUrl(p: FreeSearchParams): string {
  const limit = clampPerPage(p.perPage, 100);
  const qs = new URLSearchParams({ query: p.text.trim(), limit: String(limit), fields: S2_SEARCH_FIELDS });
  const { yearFrom, yearTo } = p.filters ?? {};
  // Semantic Scholar admite rangos: «2015-2020», «2015-», «-2015»
  if (yearFrom && yearTo) qs.set("year", `${yearFrom}-${yearTo}`);
  else if (yearFrom) qs.set("year", `${yearFrom}-`);
  else if (yearTo) qs.set("year", `-${yearTo}`);
  // OJO: el orden por citas NO se pide aquí. `sort` solo existe en /paper/search/bulk; en /paper/search
  // se ignora, así que se aplica después sobre los resultados ya leídos (ver SemanticScholarSource.search).
  if (p.page && p.page > 1) qs.set("offset", String((p.page - 1) * limit));
  return `${S2_BASE}/paper/search?${qs}`;
}

export function parseS2Work(r: any, fetchedAt: string): Work {
  const ids = r?.externalIds ?? {};
  const authors: AuthorRef[] = (r?.authors ?? []).map((a: any) => ({ name: String(a?.name ?? "").trim() })).filter((a: AuthorRef) => a.name);
  const oa = r?.openAccessPdf?.url ?? null;
  const types: string[] = Array.isArray(r?.publicationTypes) ? r.publicationTypes : [];
  const paperId = r?.paperId ? String(r.paperId) : null;
  return {
    title: stripTags(r?.title) || "(sin título)",
    authors,
    year: typeof r?.year === "number" ? r.year : null,
    venue: r?.venue ? String(r.venue) : null,
    doi: normalizeDoi(ids.DOI ?? ids.doi ?? null),
    pmid: normalizePmid(ids.PubMed ?? null),
    type: types.includes("Review") ? "review" : "article",
    citedByCount: typeof r?.citationCount === "number" ? r.citationCount : null,
    isOpenAccess: !!oa,
    oaUrl: oa,
    landingUrl: paperId ? `https://www.semanticscholar.org/paper/${paperId}` : null,
    source: "semanticscholar",
    fetchedAt,
  };
}

export class SemanticScholarSource implements FreeSource {
  readonly id = "semanticscholar" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildS2SearchUrl(p);
    const body = parseJson("semanticscholar", (await getText(this.http, "semanticscholar", url, this.opts.timeoutMs ?? 20_000)).text);
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    let works: Work[] = (body?.data ?? []).map((r: any) => parseS2Work(r, at));
    // La búsqueda de Semantic Scholar no filtra por acceso abierto: se aplica aquí, con el dato por
    // artículo (openAccessPdf), para no mostrar resultados que incumplen el filtro pedido.
    if (p.filters?.openAccess) works = works.filter((w) => w.isOpenAccess);
    // `sort` no existe en /paper/search (solo en /paper/search/bulk): el orden por citas se aplica
    // sobre la página ya leída, para que la lista se vea como el usuario la pidió.
    if (p.sort === "cited") works = [...works].sort((a, b) => (b.citedByCount ?? -1) - (a.citedByCount ?? -1));
    // `total` se deja tal como lo informa la fuente (igual que las demás fuentes), para no romper la paginación.
    return { source: "semanticscholar", works, total: Number(body?.total ?? 0), url };
  }
}
