import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorRequestEmail, buildCrossrefUrl, buildDoajUrl, buildEsearchUrl, buildEuropePmcUrl, CrossrefClient, DoajClient,
  EuropePmcClient, googleScholarForWork, googleScholarUrl, institutionalUrl, mailtoLink, mergeResults, parsePubmedXml,
  PubMedClient, searchSources, SourceError, stripTags, UnpaywallClient, type FreeSource, type HttpGet,
} from "../src/index.ts";

/**
 * Respuestas REALES grabadas el 2026-10-15 desde el navegador del usuario (ver fixtures/FUENTES.md).
 * Aquí se reproducen sin conexión para probar el análisis; no hay datos inventados.
 */
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const NOW = () => new Date("2026-10-15T13:00:00Z");

function replay(map: Record<string, { status?: number; body: string }>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`sin respuesta grabada para ${url}`);
    const { status = 200, body } = map[key]!;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("Crossref", () => {
  it("analiza la respuesta real: autores, año, revista, resumen sin etiquetas JATS, tipo", async () => {
    const http = replay({ "api.crossref.org/works": { body: fx("crossref-search-stenocarpella.json") } });
    const r = await new CrossrefClient(http, { mailto: () => "investigador@example.org", now: NOW }).search({ text: "Stenocarpella maydis", perPage: 3 });
    expect(r.total).toBe(2459);
    expect(r.works).toHaveLength(3);
    const bj = r.works[0]!;
    expect(bj).toMatchObject({
      title: "Stenocarpella macrospora and Stenocarpella maydis in the cerrado and southern Brazil regions",
      year: 2017, venue: "Bioscience Journal", doi: "10.14393/bj-v33n1a2017-36068", type: "article", citedByCount: 3, source: "crossref",
      isOpenAccess: null, oaUrl: null,
    });
    expect(bj.authors.map((a) => a.name)).toEqual(["Justino Luiz Mário", "Cássio Freitas Gozuen", "Fernando Cezar Juliatti"]);
    expect(bj.authors[2]!.orcid).toBe("0000-0001-7987-7822");
    expect(bj.abstract).toMatch(/^Stenocarpella macrospora and Stenocarpella maydis may result/);
    expect(bj.abstract).not.toContain("<jats:p>");
    expect(r.works[1]).toMatchObject({ type: "dataset", authors: [{ name: "CABI" }], year: 2021 });
    expect(r.url).toContain("mailto=…");
    expect(r.url).not.toContain("investigador@example.org");
  });

  it("construye filtros de año y orden verificados en la API", () => {
    const u = new URL(buildCrossrefUrl({ text: "Stenocarpella", filters: { yearFrom: 2015, yearTo: 2025 }, sort: "cited", page: 2, perPage: 20 }));
    expect(u.searchParams.get("filter")).toBe("from-pub-date:2015,until-pub-date:2025");
    expect(u.searchParams.get("sort")).toBe("is-referenced-by-count");
    expect(u.searchParams.get("order")).toBe("desc");
    expect(u.searchParams.get("offset")).toBe("20");
  });

  it("explica el error 400 real con el mensaje de Crossref", async () => {
    const http = replay({ "api.crossref.org": { status: 400, body: fx("crossref-error-400.json") } });
    const e = await new CrossrefClient(http).search({ text: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.message).toMatch(/^Crossref rechazó la consulta: Select 'language' specified/);
  });
});

describe("PubMed", () => {
  it("esearch + efetch: conserva el orden, extrae resumen, autor con ORCID, DOI del artículo (no de sus referencias) y PMC", async () => {
    const http = replay({
      "esearch.fcgi": { body: fx("pubmed-esearch-stenocarpella.json") },
      "efetch.fcgi": { body: fx("pubmed-efetch-41141834.xml") },
    });
    const r = await new PubMedClient(http, { email: () => "investigador@example.org", now: NOW }).search({ text: "Stenocarpella maydis", perPage: 3 });
    expect(r.total).toBe(35);
    expect(http.calls[1]).toContain("id=41854069%2C41141834%2C36440382");
    // La respuesta grabada de efetch es solo del artículo 41141834
    expect(r.works).toHaveLength(1);
    const w = r.works[0]!;
    expect(w).toMatchObject({
      title: "Improved Extraction of the Neurotoxin of Stenocarpella maydis Using an Artificial Rumen",
      pmid: "41141834", doi: "10.1155/vmi/4160516", year: 2025, venue: "Veterinary medicine international", language: "en",
      type: "article", isOpenAccess: true, oaUrl: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12552071/", source: "pubmed",
    });
    expect(w.authors).toEqual([{ name: "Leendert Dekker Snyman", orcid: "0009-0007-8094-3963" }]);
    expect(w.abstract).toMatch(/^Due to the low yield of diplonine/);
    expect(w.abstract).toContain("only 1/10th of an S. maydis culture");
    expect(w.keywords).toContain("diplodiosis");
    expect(r.url).not.toContain("investigador@example.org");
  });

  it("el XML con entidades se decodifica", () => {
    const [w] = parsePubmedXml(fx("pubmed-efetch-41141834.xml"), "x");
    expect(w!.title).not.toMatch(/<i>|&/);
  });

  it("años y solo texto libre: parámetros de E-utilities", () => {
    const u = new URL(buildEsearchUrl({ text: "Ralstonia", filters: { yearFrom: 2015, openAccess: true }, sort: "recent" }));
    expect(u.searchParams.get("mindate")).toBe("2015");
    expect(u.searchParams.get("maxdate")).toBe("3000");
    expect(u.searchParams.get("datetype")).toBe("pdat");
    expect(u.searchParams.get("term")).toBe("(Ralstonia) AND free full text[sb]");
    expect(u.searchParams.get("sort")).toBe("pub_date");
  });
});

describe("Europe PMC", () => {
  it("analiza artículo de PubMed y preprint: enlace al PDF abierto, ORCID, tipo preprint", async () => {
    const http = replay({ "europepmc/webservices": { body: fx("europepmc-search-stenocarpella.json") } });
    const r = await new EuropePmcClient(http, { now: NOW }).search({ text: "Stenocarpella maydis", perPage: 2 });
    expect(r.total).toBe(178);
    const [a, b] = r.works;
    expect(a).toMatchObject({
      title: "Improved Extraction of the Neurotoxin of Stenocarpella maydis Using an Artificial Rumen",
      doi: "10.1155/vmi/4160516", pmid: "41141834", isOpenAccess: true, oaUrl: "https://europepmc.org/articles/PMC12552071?pdf=render",
      landingUrl: "https://europepmc.org/article/MED/41141834", type: "article", language: "en",
    });
    expect(b).toMatchObject({ type: "preprint", venue: "Research Square", doi: "10.21203/rs.3.rs-4566140/v1", pmid: null, year: 2024 });
    expect(b!.authors[0]).toEqual({ name: "Adriano Francis Dorigan", orcid: null });
    expect(b!.abstract).toMatch(/^Stenocarpella maydis causes high production losses/);
    expect(b!.abstract).not.toContain("<italic>");
  });

  it("filtros de año, acceso abierto y orden", () => {
    const u = new URL(buildEuropePmcUrl({ text: "maize", filters: { yearFrom: 2015, yearTo: 2025, openAccess: true }, sort: "recent", page: 3 }));
    expect(u.searchParams.get("query")).toBe("((maize) AND PUB_YEAR:[2015 TO 2025]) AND OPEN_ACCESS:Y");
    expect(u.searchParams.get("sort")).toBe("P_PDATE_D desc");
    expect(u.searchParams.get("page")).toBe("3");
  });
});

describe("DOAJ", () => {
  it("analiza la respuesta real; todo es acceso abierto", async () => {
    const http = replay({ "doaj.org/api": { body: fx("doaj-search-stenocarpella.json") } });
    const r = await new DoajClient(http, { now: NOW }).search({ text: "Stenocarpella maydis", perPage: 2 });
    expect(r.total).toBe(23);
    expect(r.works[0]).toMatchObject({
      title: "Effects of Stenocarpella maydis in seeds and in the initial development of corn",
      year: 2014, venue: "Journal of Seed Science", isOpenAccess: true, type: "article",
      oaUrl: "http://www.scielo.br/scielo.php?script=sci_arttext&pid=S2317-15372014000100010&tlng=en",
      landingUrl: "https://doaj.org/article/01dae57461a446df9c63a6f3389da6f7",
    });
    expect(r.works[0]!.authors.map((a) => a.name)).toContain("José da Cruz Machado");
    expect(r.works[1]).toMatchObject({ venue: "IMA Fungus", year: 2011 });
  });

  it("quita caracteres que bloquean la consulta y agrega el rango de años", () => {
    const u = buildDoajUrl({ text: "maíz (Zea mays): Stenocarpella", filters: { yearFrom: 2015, yearTo: 2025 } });
    expect(decodeURIComponent(u.split("/articles/")[1]!.split("?")[0]!)).toBe("(maíz Zea mays Stenocarpella) AND bibjson.year:[2015 TO 2025]");
  });
});

describe("Unpaywall (copias legales gratuitas)", () => {
  const email = () => "investigador@example.org";
  it("oro: mejor copia en la editorial y copias verdes en repositorios", async () => {
    const http = replay({ "api.unpaywall.org": { body: fx("unpaywall-oa-fpls.json") } });
    const info = await new UnpaywallClient(http, { email }).lookup("https://doi.org/10.3389/fpls.2014.00715");
    expect(info).toMatchObject({ found: true, isOa: true, status: "gold", journal: "Frontiers in Plant Science" });
    expect(info.best).toMatchObject({ pdfUrl: "https://www.frontiersin.org/articles/10.3389/fpls.2014.00715/pdf", hostType: "publisher", license: "cc-by", version: "publishedVersion" });
    expect(info.locations.filter((l) => l.hostType === "repository").map((l) => l.repository)).toContain("National Institutes of Health");
  });
  it("bronce y cerrado", async () => {
    const http = replay({ "php-06-23-0060-rs": { body: fx("unpaywall-bronze-php.json") }, "annurev-phyto": { body: fx("unpaywall-closed-annurev.json") } });
    const c = new UnpaywallClient(http, { email });
    expect(await c.lookup("10.1094/php-06-23-0060-rs")).toMatchObject({ isOa: true, status: "bronze" });
    const closed = await c.lookup("10.1146/annurev-phyto-081211-173000");
    expect(closed).toMatchObject({ isOa: false, status: "closed", best: null, locations: [] });
  });
  it("DOI inexistente (404 en HTML real) y falta de correo", async () => {
    const http = replay({ "api.unpaywall.org": { status: 404, body: fx("unpaywall-404.html") } });
    expect(await new UnpaywallClient(http, { email }).lookup("10.9999/no-existe-biociencia")).toMatchObject({ found: false, isOa: false });
    await expect(new UnpaywallClient(http, { email: () => null }).lookup("10.1234/x")).rejects.toThrow(/correo de contacto/);
  });
  it("el correo no se envía más que a Unpaywall y la consulta se recuerda", async () => {
    const http = replay({ "api.unpaywall.org": { body: fx("unpaywall-oa-fpls.json") } });
    const c = new UnpaywallClient(http, { email });
    await c.lookup("10.3389/fpls.2014.00715");
    await c.lookup("10.3389/FPLS.2014.00715");
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]).toMatch(/^https:\/\/api\.unpaywall\.org\/v2\/10\.3389\/fpls\.2014\.00715\?email=investigador%40example\.org$/);
  });
});

describe("búsqueda combinada", () => {
  it("une el mismo artículo de PubMed y Europe PMC en una ficha con ambas fuentes", async () => {
    const http = replay({
      "esearch.fcgi": { body: fx("pubmed-esearch-stenocarpella.json") },
      "efetch.fcgi": { body: fx("pubmed-efetch-41141834.xml") },
      "europepmc/webservices": { body: fx("europepmc-search-stenocarpella.json") },
      "doaj.org/api": { body: fx("doaj-search-stenocarpella.json") },
      "api.crossref.org": { body: fx("crossref-search-stenocarpella.json") },
    });
    const sources: FreeSource[] = [new EuropePmcClient(http), new PubMedClient(http), new CrossrefClient(http), new DoajClient(http)];
    const r = await searchSources(sources, { text: "Stenocarpella maydis", perPage: 3 });
    // 2 (EPMC) + 1 (PubMed, repetido) + 3 (Crossref) + 2 (DOAJ) = 8 recibidos; 7 distintos
    expect(r.works).toHaveLength(7);
    const neuro = r.works.find((w) => w.doi === "10.1155/vmi/4160516")!;
    expect(neuro.foundIn).toEqual(["europepmc", "pubmed"]);
    expect(r.outcomes.map((o) => [o.source, o.total, o.error])).toEqual([
      ["europepmc", 178, null], ["pubmed", 35, null], ["crossref", 2459, null], ["doaj", 23, null],
    ]);
    // Intercalado: el primero de cada fuente va antes que los segundos
    expect(r.works.slice(0, 3).map((w) => w.foundIn[0])).toEqual(["europepmc", "crossref", "doaj"]);
  });

  it("si una fuente falla, las demás responden y el error se informa", async () => {
    const http = replay({ "europepmc/webservices": { body: fx("europepmc-search-stenocarpella.json") }, "api.crossref.org": { status: 503, body: "Service Unavailable" } });
    const r = await searchSources([new EuropePmcClient(http), new CrossrefClient(http)], { text: "Stenocarpella maydis" });
    expect(r.works).toHaveLength(2);
    expect(r.outcomes[1]).toMatchObject({ source: "crossref", error: "Crossref respondió con un error (503)." });
  });

  it("con «solo acceso abierto», Crossref no se consulta porque no puede filtrarlo", async () => {
    const http = replay({ "europepmc/webservices": { body: fx("europepmc-search-stenocarpella.json") } });
    const r = await searchSources([new EuropePmcClient(http), new CrossrefClient(http)], { text: "x", filters: { openAccess: true } });
    expect(r.outcomes[1]!.skipped).toMatch(/no permite filtrar por acceso abierto/);
    expect(http.calls.some((u) => u.includes("crossref"))).toBe(false);
  });

  it("mergeResults completa datos faltantes (citas de una fuente, resumen de otra)", () => {
    const base = { title: "T", authors: [{ name: "A B" }], year: 2020, fetchedAt: "x" };
    const m = mergeResults([
      { source: "crossref", works: [{ ...base, doi: "10.1234/abc", citedByCount: 5, source: "crossref" }] },
      { source: "pubmed", works: [{ ...base, doi: "10.1234/ABC", pmid: "123", abstract: "Resumen", source: "pubmed" }] },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ doi: "10.1234/abc", pmid: "123", abstract: "Resumen", citedByCount: 5, foundIn: ["crossref", "pubmed"] });
  });
});

describe("enlaces de acceso legal", () => {
  const w = { title: "Breeding for resistances to Ralstonia solanacearum", doi: "10.3389/fpls.2014.00715", venue: "Frontiers in Plant Science", year: 2014, authors: [{ name: "Gaëlle Huet" }], landingUrl: null };
  it("Google Académico se abre en el navegador (sin API)", () => {
    expect(googleScholarUrl("Ralstonia solanacearum")).toBe("https://scholar.google.com/scholar?q=Ralstonia%20solanacearum");
    expect(googleScholarForWork(w)).toContain("%22Breeding%20for%20resistances");
  });
  it("proxy institucional solo con https y con o sin {url}", () => {
    expect(institutionalUrl("https://login.ezproxy.uni.edu/login?url=", w)).toBe("https://login.ezproxy.uni.edu/login?url=https%3A%2F%2Fdoi.org%2F10.3389%2Ffpls.2014.00715");
    expect(institutionalUrl("https://proxy.lib/go?u={url}&x=1", w)).toBe("https://proxy.lib/go?u=https%3A%2F%2Fdoi.org%2F10.3389%2Ffpls.2014.00715&x=1");
    expect(institutionalUrl("javascript:alert(1)", w)).toBeNull();
    expect(institutionalUrl("", w)).toBeNull();
  });
  it("correo al autor en español e inglés con la referencia completa", () => {
    const { subject, body } = authorRequestEmail(w, "Christopher Suárez");
    expect(subject).toContain("Breeding for resistances");
    expect(body).toContain("Estimado/a Dr./Dra. Gaëlle Huet");
    expect(body).toContain("https://doi.org/10.3389/fpls.2014.00715");
    expect(body.trim().endsWith("Christopher Suárez")).toBe(true);
    expect(mailtoLink("autor@uni.edu", subject, body)).toMatch(/^mailto:autor@uni\.edu\?subject=/);
  });
  it("stripTags limpia JATS y entidades", () => {
    expect(stripTags("<jats:p>Uno &amp; dos</jats:p><jats:p>tres&#xe9;</jats:p>")).toBe("Uno & dos\ntresé");
  });
});
