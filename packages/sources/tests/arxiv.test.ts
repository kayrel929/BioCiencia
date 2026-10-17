import { describe, expect, it } from "vitest";
import { arxivQuery, ArxivClient, buildArxivUrl, parseArxivEntry, parseArxivFeed, SourceError, type HttpGet } from "../src/index.ts";

/** Respuesta simulada del servicio (sin salir a internet). */
function httpReturning(status: number, body: string) {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    return { ok: status < 300, status, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet;
  return { http, calls };
}

/** Un `<entry>` tal como lo envía arXiv (recortado). */
const ENTRY = `<entry>
    <id>http://arxiv.org/abs/2607.02621v1</id>
    <title>Seed-applied biocontrol: towards a new generation of protective strategies</title>
    <updated>2026-07-02T08:15:06Z</updated>
    <link href="https://arxiv.org/abs/2607.02621v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2607.02621v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Seeds are fundamental to agricultural productivity &amp; act as vectors.</summary>
    <category term="q-bio.OT" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-07-02T08:15:06Z</published>
    <arxiv:primary_category term="q-bio.OT"/>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">14e conférence sur les maladies des plantes, 2025</arxiv:journal_ref>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.3390/plants14010001</arxiv:doi>
    <author>
      <name>Tracy Francois</name>
      <arxiv:affiliation>IJPB</arxiv:affiliation>
    </author>
    <author>
      <name>Stéphanie Boutet</name>
    </author>
  </entry>`;

const FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query: search_query=all:biocontrol</title>
  <opensearch:totalResults>23</opensearch:totalResults>
  ${ENTRY}
</feed>`;

describe("arXiv (preprints gratuitos)", () => {
  it("arma la consulta uniendo las palabras con AND y quita lo que la rompería", () => {
    expect(arxivQuery("trichoderma biocontrol")).toBe("all:trichoderma AND all:biocontrol");
    expect(arxivQuery('trichoderma (biocontrol) "suelo"')).toBe("all:trichoderma AND all:biocontrol AND all:suelo");
    expect(arxivQuery("  ")).toBe("");
  });

  it("arma la dirección con el rango de años y la página", () => {
    const u = buildArxivUrl({ text: "trichoderma biocontrol", filters: { yearFrom: 2015, yearTo: 2020 }, page: 2, perPage: 20 });
    expect(u).toContain("https://export.arxiv.org/api/query?");
    expect(u).toContain("search_query=all%3Atrichoderma+AND+all%3Abiocontrol+AND+submittedDate%3A%5B201501010000+TO+202012312359%5D");
    expect(u).toContain("start=20");
    expect(u).toContain("max_results=20");
    // Sin rango de años no se añade la fecha
    expect(buildArxivUrl({ text: "trichoderma" })).not.toContain("submittedDate");
    // El máximo de la casa es 100 por página
    expect(buildArxivUrl({ text: "trichoderma", perPage: 500 })).toContain("max_results=100");
  });

  it("pide alguna palabra antes de consultar", () => {
    expect(() => buildArxivUrl({ text: "!!!" })).toThrow(SourceError);
    expect(() => buildArxivUrl({ text: "!!!" })).toThrow(/palabra/i);
  });

  it("lee una ficha: identificador, autores, revista, DOI y enlaces", () => {
    const w = parseArxivEntry(ENTRY, "2026-10-17T00:00:00Z");
    expect(w).toMatchObject({
      title: "Seed-applied biocontrol: towards a new generation of protective strategies",
      year: 2026,
      arxivId: "2607.02621",
      doi: "10.3390/plants14010001",
      type: "article",
      isOpenAccess: true,
      oaUrl: "https://arxiv.org/pdf/2607.02621",
      landingUrl: "https://arxiv.org/abs/2607.02621",
      source: "arxiv",
    });
    expect(w.authors).toEqual([{ name: "Tracy Francois" }, { name: "Stéphanie Boutet" }]);
    expect(w.abstract).toContain("agricultural productivity & act as vectors");
    expect(w.venue).toContain("maladies des plantes");
  });

  it("marca como preprint lo que aún no se publicó en revista", () => {
    const sinRevista = ENTRY.replace(/<arxiv:journal_ref[^>]*>[\s\S]*?<\/arxiv:journal_ref>/, "");
    expect(parseArxivEntry(sinRevista, "2026-10-17T00:00:00Z").type).toBe("preprint");
  });

  it("lee el feed completo con el total informado", () => {
    const { works, total } = parseArxivFeed(FEED, "2026-10-17T00:00:00Z");
    expect(total).toBe(23);
    expect(works).toHaveLength(1);
    expect(works[0]!.arxivId).toBe("2607.02621");
  });

  it("no se rompe si el feed viene vacío", () => {
    expect(parseArxivFeed("<feed><opensearch:totalResults>0</opensearch:totalResults></feed>", "x")).toEqual({ works: [], total: 0 });
  });

  it("la búsqueda devuelve la lista y el total", async () => {
    const { http, calls } = httpReturning(200, FEED);
    const r = await new ArxivClient(http).search({ text: "biocontrol", perPage: 10 });
    expect(r.source).toBe("arxiv");
    expect(r.total).toBe(23);
    expect(r.works[0]).toMatchObject({ source: "arxiv", arxivId: "2607.02621" });
    expect(calls[0]).toContain("/api/query?");
  });
});
