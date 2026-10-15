import { normalizeDoi, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, parseJson, SourceError, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Crossref (https://api.crossref.org) — gratuito, metadatos de casi todos los DOI.
 * Con `mailto` las consultas van al grupo «polite» (más estable). Verificado el 2026-10-15.
 */
export const CROSSREF_BASE = "https://api.crossref.org";
export const CROSSREF_SELECT = "DOI,title,author,issued,container-title,type,abstract,is-referenced-by-count,URL,volume,issue,page,publisher,subject,ISSN";

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article",
  "proceedings-article": "article",
  "posted-content": "preprint",
  "book-chapter": "book-chapter",
  book: "book",
  monograph: "book",
  dissertation: "dissertation",
  dataset: "dataset",
};

export function buildCrossrefUrl(p: FreeSearchParams, mailto?: string | null): string {
  const rows = clampPerPage(p.perPage, 100);
  const qs = new URLSearchParams({ query: p.text.trim(), rows: String(rows), offset: String((Math.max(p.page ?? 1, 1) - 1) * rows), select: CROSSREF_SELECT });
  const f: string[] = [];
  const { yearFrom, yearTo } = p.filters ?? {};
  if (yearFrom) f.push(`from-pub-date:${yearFrom}`);
  if (yearTo) f.push(`until-pub-date:${yearTo}`);
  if (f.length) qs.set("filter", f.join(","));
  if (p.sort === "cited") {
    qs.set("sort", "is-referenced-by-count");
    qs.set("order", "desc");
  } else if (p.sort === "recent") {
    qs.set("sort", "published");
    qs.set("order", "desc");
  }
  if (mailto) qs.set("mailto", mailto);
  return `${CROSSREF_BASE}/works?${qs}`;
}

export function parseCrossrefWork(r: any, fetchedAt: string): Work {
  const authors: AuthorRef[] = (r.author ?? [])
    .map((a: any) => ({
      name: a.name ?? [a.given, a.family].filter(Boolean).join(" "),
      orcid: a.ORCID ? String(a.ORCID).replace(/^https?:\/\/orcid\.org\//, "") : null,
    }))
    .filter((a: AuthorRef) => a.name);
  const year = r.issued?.["date-parts"]?.[0]?.[0];
  const doi = normalizeDoi(r.DOI ?? null);
  return {
    title: stripTags(r.title?.[0]) || "(sin título)",
    authors,
    year: typeof year === "number" ? year : null,
    venue: r["container-title"]?.[0] ?? null,
    doi,
    abstract: stripTags(r.abstract) || null,
    keywords: Array.isArray(r.subject) ? r.subject : [],
    type: TYPE_MAP[r.type] ?? (r.type ? "other" : null),
    citedByCount: typeof r["is-referenced-by-count"] === "number" ? r["is-referenced-by-count"] : null,
    // Crossref no dice si el artículo es de acceso abierto: eso lo resuelve Unpaywall
    isOpenAccess: null,
    oaUrl: null,
    landingUrl: r.URL ?? (doi ? `https://doi.org/${doi}` : null),
    source: "crossref",
    fetchedAt,
  };
}

export class CrossrefClient implements FreeSource {
  readonly id = "crossref" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { mailto?: () => string | null; now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildCrossrefUrl(p, this.opts.mailto?.());
    let res;
    try {
      res = await getText(this.http, "crossref", url, this.opts.timeoutMs);
    } catch (e) {
      // Crossref explica los errores 400 en message[].message
      if (e instanceof SourceError && e.status === 400 && e.detail) {
        try {
          const m = JSON.parse(e.detail)?.message?.[0]?.message;
          if (m) throw new SourceError("crossref", `Crossref rechazó la consulta: ${String(m).slice(0, 160)}`, 400, e.detail);
        } catch (inner) {
          if (inner instanceof SourceError) throw inner;
        }
      }
      throw e;
    }
    const body = parseJson("crossref", res.text);
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    return {
      source: "crossref",
      works: (body?.message?.items ?? []).map((r: any) => parseCrossrefWork(r, at)),
      total: Number(body?.message?.["total-results"] ?? 0),
      url: url.replace(/([?&])mailto=[^&]*/, "$1mailto=…"),
    };
  }
}
