import { normalizeDoi, normalizeOpenAlexId, type AuthorRef, type Work } from "@biociencia/core";

/**
 * Cliente de OpenAlex (https://docs.openalex.org).
 *
 * Verificado el 2026-10-14 contra la API real (respuestas guardadas en tests/fixtures):
 *  - Permite llamadas desde el navegador (Access-Control-Allow-Origin: *).
 *  - Cobra por uso: listas y búsquedas 0,001 USD; DOI y autocompletado 0 USD.
 *    Sin clave, el límite diario es 0,10 USD (≈100 búsquedas). Se informa al usuario.
 *  - Los errores 400 traen { error, message } en JSON.
 */

export const OPENALEX_BASE = "https://api.openalex.org";

/** Campos que se piden para reducir el tamaño de la respuesta. */
export const WORK_FIELDS = [
  "id", "doi", "title", "display_name", "publication_year", "publication_date", "type", "language",
  "cited_by_count", "ids", "authorships", "primary_location", "best_oa_location", "open_access",
  "keywords", "abstract_inverted_index", "primary_topic",
].join(",");

/** Dominios científicos de OpenAlex (ids verificados en /domains). */
export const DOMAINS = [
  { id: "1", label: "Ciencias de la vida" },
  { id: "2", label: "Ciencias sociales" },
  { id: "3", label: "Ciencias físicas e ingeniería" },
  { id: "4", label: "Ciencias de la salud" },
] as const;

export const WORK_TYPES: Record<string, string> = {
  article: "Artículo",
  review: "Revisión",
  preprint: "Preprint",
  "book-chapter": "Capítulo de libro",
  book: "Libro",
  dissertation: "Tesis",
  dataset: "Conjunto de datos",
  letter: "Carta",
  editorial: "Editorial",
  other: "Otro",
};

export type SearchMode = "keywords" | "title" | "author" | "journal";
export type SortOrder = "relevance" | "cited" | "recent";

export interface SearchFilters {
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccess?: boolean;
  type?: string | null;
  language?: string | null; // ISO 639-1, p. ej. "es"
  minCitations?: number | null;
  domainId?: string | null;
  authorId?: string | null; // A123 (OpenAlex)
  sourceId?: string | null; // S123 (revista)
}

export interface SearchParams {
  text: string; // texto ya preparado (ver prepareQuery)
  mode?: SearchMode;
  filters?: SearchFilters;
  sort?: SortOrder;
  page?: number;
  perPage?: number;
}

export interface SearchResult {
  works: Work[];
  total: number;
  page: number;
  perPage: number;
  url: string; // consulta exacta enviada (sin datos personales)
  costUsd: number | null;
  remainingUsd: number | null;
}

export interface AutocompleteItem {
  id: string; // A123 o S123
  name: string;
  hint: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  externalId: string | null; // ORCID o ISSN
}

export class OpenAlexError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "OpenAlexError";
  }
}

export type HttpGet = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Quita comas y dos puntos, que tienen significado especial en los filtros de OpenAlex. */
function filterValue(s: string): string {
  return s.replace(/[,:|]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildFilter(f: SearchFilters = {}, mode: SearchMode = "keywords", text = ""): string[] {
  const parts: string[] = [];
  const from = f.yearFrom ?? null;
  const to = f.yearTo ?? null;
  if (from && to) parts.push(`publication_year:${Math.min(from, to)}-${Math.max(from, to)}`);
  else if (from) parts.push(`publication_year:>${from - 1}`);
  else if (to) parts.push(`publication_year:<${to + 1}`);
  if (f.openAccess) parts.push("is_oa:true");
  if (f.type && /^[a-z-]+$/.test(f.type)) parts.push(`type:${f.type}`);
  if (f.language && /^[a-z]{2}$/.test(f.language)) parts.push(`language:${f.language}`);
  if (f.minCitations && f.minCitations > 0) parts.push(`cited_by_count:>${Math.floor(f.minCitations) - 1}`);
  if (f.domainId && /^\d+$/.test(f.domainId)) parts.push(`primary_topic.domain.id:${f.domainId}`);
  const author = normalizeOpenAlexId(f.authorId ?? null);
  if (author?.startsWith("A")) parts.push(`authorships.author.id:${author}`);
  const source = normalizeOpenAlexId(f.sourceId ?? null);
  if (source?.startsWith("S")) parts.push(`primary_location.source.id:${source}`);
  if (mode === "title" && text.trim()) parts.push(`title.search:${filterValue(text)}`);
  return parts;
}

export function buildWorksUrl(p: SearchParams, extra: { mailto?: string | null } = {}): string {
  const mode = p.mode ?? "keywords";
  const qs = new URLSearchParams();
  // En modo autor/revista el texto puede quedar vacío: se listan los trabajos del filtro
  if ((mode === "keywords") && p.text.trim()) qs.set("search", p.text.trim());
  if ((mode === "author" || mode === "journal") && p.text.trim()) qs.set("search", p.text.trim());
  const filter = buildFilter(p.filters, mode, p.text);
  if (filter.length) qs.set("filter", filter.join(","));
  const sort = p.sort ?? "relevance";
  if (sort === "cited") qs.set("sort", "cited_by_count:desc");
  else if (sort === "recent") qs.set("sort", "publication_date:desc");
  else if (!qs.has("search")) qs.set("sort", "cited_by_count:desc"); // relevancia solo existe con búsqueda
  qs.set("per-page", String(Math.min(Math.max(p.perPage ?? 20, 1), 100)));
  qs.set("page", String(Math.max(p.page ?? 1, 1)));
  qs.set("select", WORK_FIELDS);
  if (extra.mailto) qs.set("mailto", extra.mailto);
  return `${OPENALEX_BASE}/works?${qs.toString()}`;
}

/** OpenAlex entrega el resumen como índice invertido {palabra: [posiciones]}. */
export function abstractFromInvertedIndex(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function parseOpenAlexWork(r: Json, fetchedAt: string): Work {
  const authors: AuthorRef[] = (r.authorships ?? []).map((a: Json) => ({
    name: a.author?.display_name ?? a.raw_author_name ?? "",
    orcid: a.author?.orcid ? String(a.author.orcid).replace(/^https?:\/\/orcid\.org\//, "") : null,
    openalexId: normalizeOpenAlexId(a.author?.id ?? null),
  })).filter((a: AuthorRef) => a.name);
  const pl = r.primary_location ?? {};
  const best = r.best_oa_location ?? {};
  return {
    title: (r.title ?? r.display_name ?? "").trim() || "(sin título)",
    authors,
    year: typeof r.publication_year === "number" ? r.publication_year : null,
    venue: pl.source?.display_name ?? null,
    doi: normalizeDoi(r.doi ?? r.ids?.doi ?? null),
    pmid: r.ids?.pmid ? String(r.ids.pmid).replace(/\D/g, "") || null : null,
    openalexId: normalizeOpenAlexId(r.id ?? null),
    arxivId: null,
    abstract: abstractFromInvertedIndex(r.abstract_inverted_index),
    keywords: (r.keywords ?? []).map((k: Json) => k.display_name).filter(Boolean),
    type: r.type ?? null,
    language: r.language ?? null,
    citedByCount: typeof r.cited_by_count === "number" ? r.cited_by_count : null,
    isOpenAccess: typeof r.open_access?.is_oa === "boolean" ? r.open_access.is_oa : null,
    oaUrl: best.pdf_url ?? r.open_access?.oa_url ?? null,
    landingUrl: pl.landing_page_url ?? null,
    source: "openalex",
    fetchedAt,
  };
}

function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class OpenAlexClient {
  private cache = new Map<string, { at: number; value: SearchResult }>();
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { mailto?: string | null; timeoutMs?: number; now?: () => Date } = {},
  ) {}

  setMailto(mailto: string | null) {
    this.opts.mailto = mailto;
  }

  private async get(url: string): Promise<{ status: number; body: Json; headers: { get(n: string): string | null } }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    let res;
    try {
      res = await this.http(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new OpenAlexError(
        aborted ? "OpenAlex no respondió a tiempo. Intente de nuevo." : "No se pudo conectar con OpenAlex. Revise su conexión a internet.",
        null,
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body: Json = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* cuerpo no JSON */
    }
    if (res.status === 404) return { status: 404, body, headers: res.headers };
    if (!res.ok) {
      const detail = body?.message ?? body?.error ?? text.slice(0, 300);
      if (res.status === 429) {
        throw new OpenAlexError(
          "Se alcanzó el límite de uso gratuito de OpenAlex por hoy. Su biblioteca sigue disponible; vuelva a buscar más tarde.",
          429,
          detail,
        );
      }
      if (res.status === 400) throw new OpenAlexError(`OpenAlex rechazó la consulta: ${String(detail).slice(0, 200)}`, 400, detail);
      throw new OpenAlexError(`OpenAlex respondió con un error (${res.status}). Intente más tarde.`, res.status, detail);
    }
    return { status: res.status, body, headers: res.headers };
  }

  async searchWorks(p: SearchParams): Promise<SearchResult> {
    const url = buildWorksUrl(p, { mailto: this.opts.mailto });
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value; // evita pagar dos veces la misma consulta
    const { body, headers } = await this.get(url);
    const fetchedAt = (this.opts.now?.() ?? new Date()).toISOString();
    const value: SearchResult = {
      works: (body?.results ?? []).map((r: Json) => parseOpenAlexWork(r, fetchedAt)),
      total: Number(body?.meta?.count ?? 0),
      page: Number(body?.meta?.page ?? p.page ?? 1),
      perPage: Number(body?.meta?.per_page ?? p.perPage ?? 20),
      url: url.replace(/([?&])mailto=[^&]*/, "$1mailto=…"),
      costUsd: num(headers.get("x-ratelimit-cost-usd")) ?? (typeof body?.meta?.cost_usd === "number" ? body.meta.cost_usd : null),
      remainingUsd: num(headers.get("x-ratelimit-remaining-usd")),
    };
    this.cache.set(url, { at: Date.now(), value });
    return value;
  }

  /** Busca un artículo exacto por DOI (gratuito en OpenAlex). Devuelve null si no existe. */
  async getByDoi(doiInput: string): Promise<Work | null> {
    const doi = normalizeDoi(doiInput);
    if (!doi) throw new OpenAlexError("El DOI no tiene un formato válido.", null);
    const qs = new URLSearchParams({ select: WORK_FIELDS });
    if (this.opts.mailto) qs.set("mailto", this.opts.mailto);
    const { status, body } = await this.get(`${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi).replace(/%2F/gi, "/")}?${qs}`);
    if (status === 404 || !body) return null;
    return parseOpenAlexWork(body, (this.opts.now?.() ?? new Date()).toISOString());
  }

  private async autocomplete(kind: "authors" | "sources", q: string): Promise<AutocompleteItem[]> {
    if (q.trim().length < 2) return [];
    const qs = new URLSearchParams({ q: q.trim() });
    if (this.opts.mailto) qs.set("mailto", this.opts.mailto);
    const { body } = await this.get(`${OPENALEX_BASE}/autocomplete/${kind}?${qs}`);
    return (body?.results ?? []).map((r: Json) => ({
      id: normalizeOpenAlexId(r.id) ?? r.id,
      name: r.display_name,
      hint: r.hint ?? null,
      worksCount: r.works_count ?? null,
      citedByCount: r.cited_by_count ?? null,
      externalId: r.external_id ? String(r.external_id).replace(/^https?:\/\/orcid\.org\//, "ORCID ") : null,
    }));
  }

  /** Autores con su institución: permite elegir la persona correcta (sin homónimos). Gratuito. */
  autocompleteAuthors(q: string) {
    return this.autocomplete("authors", q);
  }

  /** Revistas y repositorios. Gratuito. */
  autocompleteSources(q: string) {
    return this.autocomplete("sources", q);
  }
}
