import { normalizeDoi, normalizePmid, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, lang2, parseJson, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Europe PMC (https://europepmc.org/RestfulWebService) — gratuito. Incluye todo PubMed,
 * preprints y miles de textos completos de acceso abierto. Verificado el 2026-10-15.
 */
export const EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export function buildEuropePmcUrl(p: FreeSearchParams): string {
  let query = p.text.trim();
  const { yearFrom, yearTo, openAccess } = p.filters ?? {};
  if (yearFrom || yearTo) query = `(${query}) AND PUB_YEAR:[${yearFrom ?? 1800} TO ${yearTo ?? 3000}]`;
  if (openAccess) query = `(${query}) AND OPEN_ACCESS:Y`;
  const qs = new URLSearchParams({ query, format: "json", resultType: "core", pageSize: String(clampPerPage(p.perPage, 100)), page: String(Math.max(p.page ?? 1, 1)) });
  if (p.sort === "cited") qs.set("sort", "CITED desc");
  else if (p.sort === "recent") qs.set("sort", "P_PDATE_D desc");
  return `${EUROPEPMC_BASE}/search?${qs}`;
}

export function parseEuropePmcWork(r: any, fetchedAt: string): Work {
  const authors: AuthorRef[] = (r.authorList?.author ?? [])
    .map((a: any) => ({
      name: a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : a.fullName ?? a.collectiveName ?? "",
      orcid: a.authorId?.type === "ORCID" ? a.authorId.value : null,
    }))
    .filter((a: AuthorRef) => a.name);
  const urls: any[] = r.fullTextUrlList?.fullTextUrl ?? [];
  const oa = urls.find((u) => u.availabilityCode === "OA" && u.documentStyle === "pdf") ?? urls.find((u) => u.availabilityCode === "OA") ?? urls.find((u) => u.availabilityCode === "F");
  const types: string[] = (r.pubTypeList?.pubType ?? []).map((t: string) => t.toLowerCase());
  return {
    title: stripTags(r.title).replace(/\.$/, "") || "(sin título)",
    authors,
    year: r.pubYear ? Number(r.pubYear) : null,
    venue: r.journalInfo?.journal?.title ?? r.bookOrReportDetails?.publisher ?? null,
    doi: normalizeDoi(r.doi ?? null),
    pmid: r.source === "MED" ? normalizePmid(r.pmid ?? r.id ?? null) : null,
    abstract: stripTags(r.abstractText) || null,
    keywords: r.keywordList?.keyword ?? [],
    type: types.includes("preprint") ? "preprint" : types.some((t) => t.includes("review")) ? "review" : "article",
    language: lang2(r.language),
    citedByCount: typeof r.citedByCount === "number" ? r.citedByCount : null,
    isOpenAccess: r.isOpenAccess === "Y" ? true : oa ? true : r.isOpenAccess === "N" ? false : null,
    oaUrl: oa?.url ?? null,
    landingUrl: `https://europepmc.org/article/${r.source}/${r.id}`,
    source: "europepmc",
    fetchedAt,
  };
}

export class EuropePmcClient implements FreeSource {
  readonly id = "europepmc" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildEuropePmcUrl(p);
    const body = parseJson("europepmc", (await getText(this.http, "europepmc", url, this.opts.timeoutMs)).text);
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    return { source: "europepmc", works: (body?.resultList?.result ?? []).map((r: any) => parseEuropePmcWork(r, at)), total: Number(body?.hitCount ?? 0), url };
  }
}
