import { normalizeDoi, normalizePmid, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, decodeEntities, getText, lang2, parseJson, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";
import { methodClause, studyTypeClause } from "./studies.ts";

/**
 * PubMed mediante las E-utilities de NCBI — gratuito; 3 consultas por segundo sin clave
 * (cabecera x-ratelimit-limit: 3, verificada el 2026-10-15). Una búsqueda usa 2 llamadas:
 * esearch (ids) y efetch (registros completos con resumen).
 */
export const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export function buildEsearchUrl(p: FreeSearchParams, email?: string | null): string {
  const n = clampPerPage(p.perPage, 100);
  let term = p.text.trim();
  if (p.filters?.openAccess) term = `(${term}) AND free full text[sb]`;
  const st = studyTypeClause(p.filters?.studyTypes, "pubmed");
  if (st) term = `(${term}) AND ${st}`;
  const mt = methodClause(p.filters?.method);
  if (mt) term = `(${term}) AND ${mt}`;
  const qs = new URLSearchParams({ db: "pubmed", term, retmode: "json", retmax: String(n), retstart: String((Math.max(p.page ?? 1, 1) - 1) * n), tool: "biociencia" });
  const { yearFrom, yearTo } = p.filters ?? {};
  if (yearFrom || yearTo) {
    // E-utilities exige las dos fechas
    qs.set("datetype", "pdat");
    qs.set("mindate", String(yearFrom ?? 1800));
    qs.set("maxdate", String(yearTo ?? 3000));
  }
  if (p.sort === "recent") qs.set("sort", "pub_date");
  if (email) qs.set("email", email);
  return `${EUTILS}/esearch.fcgi?${qs}`;
}

export function buildEfetchUrl(ids: string[], email?: string | null): string {
  const qs = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml", tool: "biociencia" });
  if (email) qs.set("email", email);
  return `${EUTILS}/efetch.fcgi?${qs}`;
}

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1]! : null;
};
const tags = (xml: string, name: string): { attrs: string; body: string }[] =>
  [...xml.matchAll(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => ({ attrs: m[1] ?? "", body: m[2]! }));
const attr = (attrs: string, name: string): string | null => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const text = (s: string | null) => (s ? stripTags(s) : "");

/** Convierte un <PubmedArticle> en Work. Ignora la lista de referencias (trae otros DOI). */
export function parsePubmedArticle(xmlIn: string, fetchedAt: string): Work {
  const xml = xmlIn.replace(/<ReferenceList>[\s\S]*?<\/ReferenceList>/g, "");
  const pmid = normalizePmid(text(tag(xml, "PMID")));
  const article = tag(xml, "Article") ?? xml;
  const authors: AuthorRef[] = tags(tag(article, "AuthorList") ?? "", "Author")
    .map(({ body }) => {
      const collective = text(tag(body, "CollectiveName"));
      const name = collective || [text(tag(body, "ForeName")), text(tag(body, "LastName"))].filter(Boolean).join(" ");
      const orcidTag = tags(body, "Identifier").find((i) => attr(i.attrs, "Source") === "ORCID");
      return { name, orcid: orcidTag ? orcidTag.body.replace(/^https?:\/\/orcid\.org\//, "").trim() : null };
    })
    .filter((a) => a.name);
  const abstract = tags(tag(article, "Abstract") ?? "", "AbstractText")
    .map(({ attrs, body }) => {
      const label = attr(attrs, "Label");
      return `${label ? `${decodeEntities(label)}: ` : ""}${text(body)}`;
    })
    .join("\n");
  const journal = tag(article, "Journal") ?? "";
  const pubDate = tag(journal, "PubDate") ?? "";
  const yearStr = text(tag(pubDate, "Year")) || (text(tag(pubDate, "MedlineDate")).match(/\d{4}/)?.[0] ?? "");
  const ids = tags(tag(xml, "PubmedData") ?? "", "ArticleId");
  const doiFromIds = ids.find((i) => attr(i.attrs, "IdType") === "doi")?.body ?? null;
  const doiFromEloc = tags(article, "ELocationID").find((e) => attr(e.attrs, "EIdType") === "doi")?.body ?? null;
  const pmc = ids.find((i) => attr(i.attrs, "IdType") === "pmc")?.body.trim() ?? null;
  const types = tags(article, "PublicationType").map((t) => text(t.body));
  const doi = normalizeDoi(doiFromIds ?? doiFromEloc);
  return {
    title: text(tag(article, "ArticleTitle")).replace(/\.$/, "") || "(sin título)",
    authors,
    year: yearStr ? Number(yearStr) : null,
    venue: text(tag(journal, "Title")) || null,
    volume: text(tag(journal, "Volume")) || null,
    issue: text(tag(journal, "Issue")) || null,
    pages: text(tag(tag(article, "Pagination") ?? "", "MedlinePgn")) || null,
    doi,
    pmid,
    abstract: abstract || null,
    keywords: tags(xml, "Keyword").map((k) => text(k.body)).filter(Boolean),
    type: types.includes("Review") || types.includes("Systematic Review") ? "review" : types.includes("Preprint") ? "preprint" : "article",
    language: lang2(text(tag(article, "Language"))),
    citedByCount: null,
    // Un artículo en PubMed Central se puede leer gratis y de forma legal
    isOpenAccess: pmc ? true : null,
    oaUrl: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/` : null,
    landingUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
    pubTypes: types,
    retraction: types.includes("Retracted Publication") ? { status: "retracted", source: "pubmed" } : null,
    source: "pubmed",
    fetchedAt,
  };
}

export function parsePubmedXml(xml: string, fetchedAt: string): Work[] {
  return [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)].map((m) => parsePubmedArticle(m[1]!, fetchedAt));
}

export class PubMedClient implements FreeSource {
  readonly id = "pubmed" as const;
  private last = 0;
  private gate: Promise<void> = Promise.resolve();
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { email?: () => string | null; now?: () => Date; timeoutMs?: number; minIntervalMs?: number } = {},
  ) {}

  /** NCBI permite 3 consultas por segundo sin clave: se espacian las llamadas de este cliente (≥ 400 ms). */
  private throttled: HttpGet = (url, init) => {
    const run = this.gate.then(async () => {
      const wait = this.last + (this.opts.minIntervalMs ?? 400) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    this.gate = run;
    return run.then(() => this.http(url, init));
  };

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const email = this.opts.email?.() ?? null;
    const url = buildEsearchUrl(p, email);
    const s = parseJson("pubmed", (await getText(this.throttled, "pubmed", url, this.opts.timeoutMs)).text);
    const ids: string[] = s?.esearchresult?.idlist ?? [];
    const total = Number(s?.esearchresult?.count ?? 0);
    let works: Work[] = [];
    if (ids.length) {
      const x = await getText(this.throttled, "pubmed", buildEfetchUrl(ids, email), this.opts.timeoutMs, "application/xml");
      const parsed = parsePubmedXml(x.text, (this.opts.now?.() ?? new Date()).toISOString());
      // Mantener el orden de relevancia de esearch
      const byId = new Map(parsed.map((w) => [w.pmid, w]));
      works = ids.map((id) => byId.get(id)).filter((w): w is Work => !!w);
    }
    return { source: "pubmed", works, total, url: url.replace(/([?&])email=[^&]*/, "$1email=…") };
  }
}
