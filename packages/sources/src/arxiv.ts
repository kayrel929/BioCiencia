import { normalizeArxivId, normalizeDoi, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, decodeEntities, getText, SourceError, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * arXiv (https://info.arxiv.org/help/api/index.html) — gratuito y sin clave. Publica preprints de
 * física, matemáticas, informática y algo de biología y agro. Comprobado el 2026-10-17: responde en
 * formato Atom (XML) y pide no hacer más de una consulta cada 3 segundos; una búsqueda manual lo cumple.
 */
export const ARXIV_BASE = "https://export.arxiv.org/api/query";

/** arXiv busca con `all:palabra` unidas con AND; se quitan los caracteres que romperían la consulta. */
export function arxivQuery(text: string): string {
  const words = text
    .replace(/["'()<>[\]{}/\\^~:!?*|,;]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}.\-]/gu, "").trim())
    .filter(Boolean);
  return words.map((w) => `all:${w}`).join(" AND ");
}

export function buildArxivUrl(p: FreeSearchParams): string {
  const q = arxivQuery(p.text);
  if (!q) throw new SourceError("arxiv", "Escriba alguna palabra para buscar en arXiv.", null);
  const parts = [q];
  const { yearFrom, yearTo } = p.filters ?? {};
  // arXiv filtra por fecha de envío con el formato AAAAMMDDhhmm
  if (yearFrom || yearTo) parts.push(`submittedDate:[${yearFrom ?? 1991}01010000 TO ${yearTo ?? 3000}12312359]`);
  const perPage = clampPerPage(p.perPage, 100);
  const qs = new URLSearchParams({
    search_query: parts.join(" AND "),
    start: String((Math.max(p.page ?? 1, 1) - 1) * perPage),
    max_results: String(perPage),
    sortBy: "relevance",
  });
  return `${ARXIV_BASE}?${qs}`;
}

/** Texto de una etiqueta del feed Atom (tolera atributos y decodifica entidades). */
function entryTag(entry: string, name: string): string | null {
  const m = entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  const s = m ? decodeEntities(m[1] ?? "").replace(/\s+/g, " ").trim() : "";
  return s || null;
}

/** Lee un `<entry>` del feed de arXiv y lo convierte en una publicación. */
export function parseArxivEntry(entry: string, fetchedAt: string): Work {
  const rawId = entryTag(entry, "id");
  const arxivId = normalizeArxivId(rawId);
  const published = entryTag(entry, "published");
  const journalRef = entryTag(entry, "arxiv:journal_ref");
  const authors: AuthorRef[] = [...entry.matchAll(/<author>[\s\S]*?<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/g)]
    .map((m) => ({ name: decodeEntities(m[1] ?? "").replace(/\s+/g, " ").trim() }))
    .filter((a) => a.name);
  return {
    title: stripTags(entryTag(entry, "title")) || "(sin título)",
    authors,
    year: published && /^\d{4}/.test(published) ? Number(published.slice(0, 4)) : null,
    // Cuando el autor ya lo publicó en una revista, arXiv deja ahí la referencia
    venue: journalRef,
    doi: normalizeDoi(entryTag(entry, "arxiv:doi")),
    arxivId,
    abstract: stripTags(entryTag(entry, "summary")) || null,
    type: journalRef ? "article" : "preprint",
    citedByCount: null,
    // Todo lo de arXiv es acceso abierto
    isOpenAccess: true,
    oaUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
    landingUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : rawId,
    source: "arxiv",
    fetchedAt,
  };
}

/** Lee el feed completo: los artículos y el total que informa arXiv. */
export function parseArxivFeed(xml: string, fetchedAt: string): { works: Work[]; total: number } {
  const total = Number(xml.match(/<opensearch:totalResults(?:\s[^>]*)?>(\d+)</)?.[1] ?? 0);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return { works: entries.map((e) => parseArxivEntry(e, fetchedAt)), total };
}

export class ArxivClient implements FreeSource {
  readonly id = "arxiv" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildArxivUrl(p);
    // arXiv responde XML; se pide como texto y se lee aquí mismo.
    const res = await getText(this.http, "arxiv", url, this.opts.timeoutMs ?? 25_000, "application/atom+xml");
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    const { works, total } = parseArxivFeed(res.text, at);
    return { source: "arxiv", works, total, url };
  }
}
