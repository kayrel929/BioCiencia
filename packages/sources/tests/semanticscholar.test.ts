import { describe, expect, it } from "vitest";
import { buildS2SearchUrl, parseS2Paper, parseS2Work, SemanticScholarClient, SemanticScholarSource, SourceError, type HttpGet } from "../src/index.ts";

/** Respuesta simulada de la API (sin salir a internet). */
function httpReturning(status: number, body: string) {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    return { ok: status < 300, status, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet;
  return { http, calls };
}

describe("Semantic Scholar (citas de un artículo en otra base abierta)", () => {
  it("lee el número de citas y las «influyentes»", async () => {
    const { http, calls } = httpReturning(200, JSON.stringify({ paperId: "abc123", citationCount: 12, influentialCitationCount: 3, year: 2020 }));
    const p = await new SemanticScholarClient(http).byDoi("10.21931/rb/2024.09.01.6");
    expect(p).toEqual({
      paperId: "abc123",
      citationCount: 12,
      influentialCitationCount: 3,
      year: 2020,
      url: "https://www.semanticscholar.org/paper/abc123",
    });
    expect(calls[0]).toBe("https://api.semanticscholar.org/graph/v1/paper/DOI:10.21931%2Frb%2F2024.09.01.6?fields=paperId,citationCount,influentialCitationCount,year");
  });

  it("devuelve null si el artículo no está indexado (404)", async () => {
    const { http } = httpReturning(404, "{}");
    expect(await new SemanticScholarClient(http).byDoi("10.1234/nada")).toBeNull();
  });

  it("avisa con claridad cuando la base pide esperar (429)", async () => {
    const { http } = httpReturning(429, "too many requests");
    await expect(new SemanticScholarClient(http).byDoi("10.1234/x")).rejects.toBeInstanceOf(SourceError);
    await expect(new SemanticScholarClient(http).byDoi("10.1234/x")).rejects.toThrow(/esperar/i);
  });

  it("exige un DOI con formato válido", async () => {
    const { http } = httpReturning(200, "{}");
    await expect(new SemanticScholarClient(http).byDoi("no-es-un-doi")).rejects.toThrow(/DOI/);
  });

  it("no inventa datos si la respuesta viene vacía", () => {
    expect(parseS2Paper({})).toBeNull();
    expect(parseS2Paper({ paperId: "x" })).toMatchObject({ citationCount: null, influentialCitationCount: null, year: null });
  });
});

describe("Semantic Scholar como origen de búsqueda", () => {
  it("arma la dirección con el rango de años (el orden por citas NO va en la URL)", () => {
    const u = buildS2SearchUrl({ text: "trichoderma biocontrol", filters: { yearFrom: 2015, yearTo: 2020 }, sort: "cited", perPage: 20 });
    expect(u).toContain("https://api.semanticscholar.org/graph/v1/paper/search?");
    expect(u).toContain("query=trichoderma+biocontrol");
    expect(u).toContain("year=2015-2020");
    expect(u).toContain("limit=20");
    // /paper/search no admite «sort» (solo /paper/search/bulk): el orden se aplica después, sobre lo leído
    expect(u).not.toContain("sort=");
    expect(buildS2SearchUrl({ text: "x", filters: { yearFrom: 2015 } })).toContain("year=2015-");
    expect(buildS2SearchUrl({ text: "x", filters: { yearTo: 2015 } })).toContain("year=-2015");
  });

  it("aplica el filtro de acceso abierto sobre los resultados que devuelve la base", async () => {
    const body = JSON.stringify({
      total: 2,
      data: [
        { paperId: "a", title: "Con PDF", year: 2020, citationCount: 5, openAccessPdf: { url: "https://x/a.pdf" } },
        { paperId: "b", title: "Sin PDF", year: 2021, citationCount: 50 },
      ],
    });
    const conFiltro = await new SemanticScholarSource(httpReturning(200, body).http).search({ text: "x", filters: { openAccess: true } });
    expect(conFiltro.works.map((w) => w.title)).toEqual(["Con PDF"]);
    const sinFiltro = await new SemanticScholarSource(httpReturning(200, body).http).search({ text: "x" });
    expect(sinFiltro.works).toHaveLength(2);
  });

  it("con «más citados» ordena la página por número de citas", async () => {
    const body = JSON.stringify({
      total: 2,
      data: [
        { paperId: "a", title: "Poco citado", citationCount: 2 },
        { paperId: "b", title: "Muy citado", citationCount: 99 },
      ],
    });
    const r = await new SemanticScholarSource(httpReturning(200, body).http).search({ text: "x", sort: "cited", perPage: 20 });
    expect(r.works.map((w) => w.title)).toEqual(["Muy citado", "Poco citado"]);
  });

  it("lee un artículo: DOI, PMID, citas, acceso abierto y enlace", () => {
    const w = parseS2Work({
      paperId: "abc",
      title: "In vitro evaluation",
      year: 2024,
      venue: "Bionatura",
      externalIds: { DOI: "10.21931/RB/2024", PubMed: "12345" },
      authors: [{ name: "Suárez, C" }, {}],
      citationCount: 3,
      publicationTypes: ["JournalArticle"],
      openAccessPdf: { url: "https://x/y.pdf" },
    }, "2026-10-17T00:00:00Z");
    expect(w).toMatchObject({
      doi: "10.21931/rb/2024",
      pmid: "12345",
      citedByCount: 3,
      isOpenAccess: true,
      oaUrl: "https://x/y.pdf",
      source: "semanticscholar",
      landingUrl: "https://www.semanticscholar.org/paper/abc",
    });
    expect(w.authors).toEqual([{ name: "Suárez, C" }]);
  });

  it("la búsqueda devuelve la lista y el total informado", async () => {
    const body = JSON.stringify({ total: 120, data: [{ paperId: "p1", title: "Uno", year: 2020, authors: [] }] });
    const { http, calls } = httpReturning(200, body);
    const r = await new SemanticScholarSource(http).search({ text: "trichoderma", perPage: 10 });
    expect(r.source).toBe("semanticscholar");
    expect(r.total).toBe(120);
    expect(r.works[0]).toMatchObject({ title: "Uno", source: "semanticscholar" });
    expect(calls[0]).toContain("/paper/search?");
  });
});
