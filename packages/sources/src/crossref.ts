import { normalizeDoi, worseRetraction, type RetractionInfo, type RetractionStatus, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, parseJson, SourceError, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Crossref (https://api.crossref.org) — gratuito, metadatos de casi todos los DOI.
 * Con `mailto` las consultas van al grupo «polite» (más estable). Verificado el 2026-10-15.
 */
export const CROSSREF_BASE = "https://api.crossref.org";
export const CROSSREF_SELECT = "DOI,title,author,issued,container-title,type,abstract,is-referenced-by-count,URL,volume,issue,page,publisher,subject,ISSN,updated-by";

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

const UPDATE_STATUS: Record<string, RetractionStatus> = {
  retraction: "retracted", withdrawal: "withdrawn", removal: "withdrawn",
  expression_of_concern: "concern", "expression-of-concern": "concern",
  correction: "corrected", erratum: "corrected", corrigendum: "corrected",
};

/**
 * Avisos de Crossref sobre un artículo («updated-by»), que incluyen los datos de Retraction Watch
 * (verificado el 2026-10-15 con el artículo retractado de Wakefield, 1998). Devuelve el más grave.
 */
export function crossrefRetraction(updatedBy: unknown): RetractionInfo | null {
  let out: RetractionInfo | null = null;
  for (const u of Array.isArray(updatedBy) ? updatedBy : []) {
    const status = UPDATE_STATUS[String(u?.type ?? "").toLowerCase()];
    if (!status) continue;
    const parts: number[] | undefined = u?.updated?.["date-parts"]?.[0];
    const date = parts?.length ? parts.map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-") : null;
    out = worseRetraction(out, { status, noticeDoi: normalizeDoi(u?.DOI ?? null), date, source: "crossref" });
  }
  return out;
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
    volume: r.volume ?? null,
    issue: r.issue ?? null,
    pages: r.page ?? null,
    doi,
    abstract: stripTags(r.abstract) || null,
    keywords: Array.isArray(r.subject) ? r.subject.filter((k: unknown): k is string => typeof k === "string") : [],
    type: TYPE_MAP[r.type] ?? (r.type ? "other" : null),
    citedByCount: typeof r["is-referenced-by-count"] === "number" ? r["is-referenced-by-count"] : null,
    // Crossref no dice si el artículo es de acceso abierto: eso lo resuelve Unpaywall
    isOpenAccess: null,
    oaUrl: null,
    landingUrl: r.URL ?? (doi ? `https://doi.org/${doi}` : null),
    retraction: crossrefRetraction(r["updated-by"]),
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

/**
 * Metadatos de varios DOI con una consulta por cada 20 (filtro doi:…,doi:…). Lo que Crossref no conoce se omite.
 * Crossref bloquea por un momento las consultas muy seguidas (verificado el 2026-10-15: el navegador lo ve como
 * error de conexión), por eso hay una pausa entre lotes y un reintento. Si un lote sigue fallando, se informa en `failed`.
 */
export async function crossrefByDois(
  http: HttpGet,
  dois: string[],
  fetchedAt: string,
  opts: { timeoutMs?: number; email?: string | null; pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ works: Work[]; failed: string[]; error: string | null }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pause = opts.pauseMs ?? 1000;
  const works: Work[] = [];
  const failed: string[] = [];
  let error: string | null = null;
  for (let i = 0; i < dois.length; i += 20) {
    if (i > 0) await sleep(pause);
    const chunk = dois.slice(i, i + 20);
    const qs = new URLSearchParams({ filter: chunk.map((d) => `doi:${d}`).join(","), rows: "20", select: CROSSREF_SELECT });
    if (opts.email) qs.set("mailto", opts.email);
    const url = `${CROSSREF_BASE}/works?${qs}`;
    let r;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try {
        r = await getText(http, "crossref", url, opts.timeoutMs ?? 20_000);
      } catch (e) {
        const retryable = e instanceof SourceError && (e.status === null || e.status === 429 || (e.status ?? 0) >= 500);
        if (attempt === 0 && retryable) await sleep(pause * 2);
        else {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
    }
    if (!r) {
      failed.push(...chunk);
      continue;
    }
    for (const it of parseJson("crossref", r.text)?.message?.items ?? []) works.push(parseCrossrefWork(it, fetchedAt));
  }
  return { works, failed, error };
}
