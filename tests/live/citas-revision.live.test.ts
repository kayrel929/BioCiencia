import { describe, expect, it } from "vitest";
import { CitationClient, CrossrefClient, DoajClient, EuropePmcClient, PubMedClient, runReviewSearch, type HttpGet } from "@biociencia/sources";

/**
 * EN VIVO (en su PC: `npm.cmd run test:live`): red de citas, tipo de estudio y revisión de literatura
 * contra las API reales y gratuitas. Los mínimos esperados son prudentes porque los números crecen con el tiempo.
 */
const http: HttpGet = (url, init) => fetch(url, init);
const email = process.env.BC_EMAIL ?? null;

describe("red de citas en vivo", () => {
  it("Europe PMC: referencias y citas de un artículo con PMID (Frontiers in Plant Science 2014)", async () => {
    const c = new CitationClient(http);
    const refs = await c.network({ pmid: "25566289" }, "references", 10);
    expect(refs.via).toBe("europepmc");
    expect(refs.total).toBeGreaterThanOrEqual(40);
    expect(refs.works.length).toBe(10);
    const cits = await c.network({ pmid: "25566289" }, "citations", 10);
    expect(cits.total).toBeGreaterThanOrEqual(80);
  }, 60_000);

  it("OpenCitations + Crossref: artículo solo con DOI (Bioscience Journal 2017)", async () => {
    const r = await new CitationClient(http, { email: () => email }).network({ doi: "10.14393/bj-v33n1a2017-36068" }, "citations");
    expect(r.via).toBe("opencitations");
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.works.map((w) => w.doi)).toContain("10.1016/j.funbio.2017.08.006");
  }, 60_000);
});

describe("tipo de estudio y revisión en vivo", () => {
  it("el filtro de metaanálisis reduce los resultados en PubMed y Europe PMC", async () => {
    for (const s of [new PubMedClient(http, { email: () => email }), new EuropePmcClient(http)]) {
      const all = await s.search({ text: "maize", perPage: 1 });
      const meta = await s.search({ text: "maize", perPage: 1, filters: { studyTypes: ["meta"] } });
      expect(meta.total, s.id).toBeGreaterThan(0);
      expect(meta.total, s.id).toBeLessThan(all.total / 10);
    }
  }, 60_000);

  it("estrategia booleana en 4 bases con unión de repetidos", async () => {
    const r = await runReviewSearch(
      [new PubMedClient(http, { email: () => email }), new EuropePmcClient(http), new CrossrefClient(http, { mailto: () => email }), new DoajClient(http)],
      { question: "", framework: "peo", concepts: [{ name: "c", terms: ["maize", "corn", "Zea mays"] }, { name: "p", terms: ["Stenocarpella", "Diplodia"] }] },
      { maxPerSource: 100 },
    );
    for (const run of r.runs) expect(run.error, `${run.label}: ${run.error}`).toBeFalsy();
    const pm = r.runs.find((x) => x.source === "pubmed")!;
    expect(pm.found).toBeGreaterThan(0);
    const retrieved = r.runs.reduce((n, x) => n + x.retrieved, 0);
    expect(r.works.length).toBeLessThan(retrieved); // PubMed y Europe PMC comparten artículos
  }, 120_000);
});
