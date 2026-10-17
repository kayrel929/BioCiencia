import { normalizeDoi, normalizePmid, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, lang2, parseJson, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";
import { methodClause, studyTypeClause } from "./studies.ts";

/**
 * Europe PMC (https://europepmc.org/RestfulWebService) — gratuito. Incluye todo PubMed,
 * preprints y miles de textos completos de acceso abierto. Verificado el 2026-10-15.
 */
export const EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/**
 * Europe PMC ignora el parámetro `page` (verificado el 2026-10-15: la página 1 y la 2 devolvían los mismos
 * registros); se pagina con `cursorMark`: «*» para la primera página y luego el `nextCursorMark` de cada respuesta.
 */
export function buildEuropePmcUrl(p: FreeSearchParams, cursorMark = "*"): string {
  let query = p.text.trim();
  const { yearFrom, yearTo, openAccess } = p.filters ?? {};
  if (yearFrom || yearTo) query = `(${query}) AND PUB_YEAR:[${yearFrom ?? 1800} TO ${yearTo ?? 3000}]`;
  if (openAccess) query = `(${query}) AND OPEN_ACCESS:Y`;
  const st = studyTypeClause(p.filters?.studyTypes, "epmc");
  if (st) query = `(${query}) AND ${st}`;
  const mt = methodClause(p.filters?.method);
  if (mt) query = `(${query}) AND ${mt}`;
  const qs = new URLSearchParams({ query, format: "json", resultType: "core", pageSize: String(clampPerPage(p.perPage, 100)), cursorMark });
  if (p.sort === "cited") qs.set("sort", "CITED desc");
  else if (p.sort === "recent") qs.set("sort", "P_PDATE_D desc");
  return `${EUROPEPMC_BASE}/search?${qs}`;
}

/** Correos escritos dentro de un texto de afiliación («… India. autor@inst.gov.in.»), sin el punto final. */
export function emailsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
    const e = m[0].replace(/[.-]+$/, "").toLowerCase();
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** Autores con correo publicado, según Europe PMC (por DOI o PMID). */
export async function lookupAuthorEmails(http: HttpGet, w: Pick<Work, "doi" | "pmid">, timeoutMs?: number): Promise<{ name: string; email: string; orcid: string | null }[]> {
  const doi = normalizeDoi(w.doi ?? null);
  const pmid = normalizePmid(w.pmid ?? null);
  if (!doi && !pmid) return [];
  const query = doi ? `DOI:"${doi}"` : `EXT_ID:${pmid} AND SRC:MED`;
  const url = `${EUROPEPMC_BASE}/search?${new URLSearchParams({ query, format: "json", resultType: "core", pageSize: "1" })}`;
  const body = parseJson("europepmc", (await getText(http, "europepmc", url, timeoutMs)).text);
  const r = body?.resultList?.result?.[0];
  if (!r) return [];
  return parseEuropePmcWork(r, new Date().toISOString())
    .authors.filter((a) => a.email)
    .map((a) => ({ name: a.name, email: a.email!, orcid: a.orcid ?? null }));
}

export function parseEuropePmcWork(r: any, fetchedAt: string): Work {
  const authors: AuthorRef[] = (r.authorList?.author ?? [])
    .map((a: any) => {
      const email = emailsIn((a.authorAffiliationDetailsList?.authorAffiliation ?? []).map((x: any) => x?.affiliation ?? "").join(" "))[0] ?? null;
      return {
        name: a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : a.fullName ?? a.collectiveName ?? "",
        orcid: a.authorId?.type === "ORCID" ? a.authorId.value : null,
        ...(email ? { email } : {}),
      };
    })
    .filter((a: AuthorRef) => a.name);
  const urls: any[] = r.fullTextUrlList?.fullTextUrl ?? [];
  const oa = urls.find((u) => u.availabilityCode === "OA" && u.documentStyle === "pdf") ?? urls.find((u) => u.availabilityCode === "OA") ?? urls.find((u) => u.availabilityCode === "F");
  const rawTypes: string[] = Array.isArray(r.pubTypeList?.pubType)
    ? r.pubTypeList.pubType.filter((t: unknown): t is string => typeof t === "string")
    : typeof r.pubType === "string" ? r.pubType.split(/;\s*/).filter(Boolean) : [];
  const types: string[] = rawTypes.map((t) => t.toLowerCase());
  return {
    title: stripTags(r.title).replace(/\.$/, "") || "(sin título)",
    authors,
    year: r.pubYear ? Number(r.pubYear) : null,
    venue: r.journalInfo?.journal?.title ?? r.bookOrReportDetails?.publisher ?? null,
    volume: r.journalInfo?.volume ?? null,
    issue: r.journalInfo?.issue ?? null,
    pages: r.pageInfo ?? null,
    doi: normalizeDoi(r.doi ?? null),
    pmid: r.source === "MED" ? normalizePmid(r.pmid ?? r.id ?? null) : null,
    abstract: stripTags(r.abstractText) || null,
    keywords: (r.keywordList?.keyword ?? []).filter((k: unknown): k is string => typeof k === "string"),
    type: types.includes("preprint") ? "preprint" : types.some((t) => t.includes("review")) ? "review" : "article",
    language: lang2(r.language),
    citedByCount: typeof r.citedByCount === "number" ? r.citedByCount : null,
    isOpenAccess: r.isOpenAccess === "Y" ? true : oa ? true : r.isOpenAccess === "N" ? false : null,
    oaUrl: oa?.url ?? null,
    landingUrl: `https://europepmc.org/article/${r.source}/${r.id}`,
    pubTypes: rawTypes,
    retraction: types.includes("retracted publication") ? { status: "retracted", source: "pubmed" } : null,
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

  /** Cursores conocidos por consulta: cursors[consulta][n] = cursor para pedir la página n+1 */
  private cursors = new Map<string, string[]>();

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const page = Math.max(p.page ?? 1, 1);
    const key = buildEuropePmcUrl(p, "*");
    const known = this.cursors.get(key) ?? ["*"];
    this.cursors.set(key, known);
    let body: any = null;
    let url = key;
    // Si se pide una página cuyo cursor aún no se conoce, se recorren las anteriores
    for (let i = Math.min(known.length, page) - 1; i < page; i++) {
      const cursor = known[i]!;
      url = buildEuropePmcUrl(p, cursor);
      body = parseJson("europepmc", (await getText(this.http, "europepmc", url, this.opts.timeoutMs)).text);
      const next = body?.nextCursorMark;
      const results = body?.resultList?.result ?? [];
      // Fin de la lista: sin cursor nuevo o sin resultados
      if (!next || next === cursor || !results.length) {
        if (i < page - 1) return { source: "europepmc", works: [], total: Number(body?.hitCount ?? 0), url };
        break;
      }
      known[i + 1] = next;
    }
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    return { source: "europepmc", works: (body?.resultList?.result ?? []).map((r: any) => parseEuropePmcWork(r, at)), total: Number(body?.hitCount ?? 0), url };
  }
}

/** DOI marcados como «Retracted Publication» en PubMed / Europe PMC (consulta por lotes de 25). */
export async function europePmcRetractedDois(http: HttpGet, dois: string[], timeoutMs?: number): Promise<Set<string>> {
  const out = new Set<string>();
  const clean = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  for (let i = 0; i < clean.length; i += 25) {
    const chunk = clean.slice(i, i + 25);
    const query = `(${chunk.map((d) => `DOI:"${d}"`).join(" OR ")}) AND PUB_TYPE:"Retracted Publication"`;
    const url = `${EUROPEPMC_BASE}/search?${new URLSearchParams({ query, format: "json", resultType: "lite", pageSize: "100" })}`;
    const body = parseJson("europepmc", (await getText(http, "europepmc", url, timeoutMs)).text);
    for (const r of body?.resultList?.result ?? []) {
      const d = normalizeDoi(r?.doi ?? null);
      if (d) out.add(d);
    }
  }
  return out;
}
