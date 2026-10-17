import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatReference, segsToText } from "@biociencia/core";
import {
  buildEsearchUrl, buildEuropePmcUrl, CitationClient, epmcAuthor, methodClause, parseOpenCitations, searchSources, studyTypeClause,
  type FreeSource, type HttpGet,
} from "../src/index.ts";

/** Respuestas REALES grabadas el 2026-10-15 desde el navegador del usuario (fixtures/FUENTES.md). */
const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const NOW = () => new Date("2026-10-15T18:00:00Z");

function replay(map: Record<string, string>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`sin respuesta grabada para ${url}`);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => map[key]! };
  }) as unknown as HttpGet & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("red de citas (bola de nieve)", () => {
  it("Europe PMC: referencias de un artículo con PMID, con autores convertidos a «Apellido, I»", async () => {
    const http = replay({ "/MED/25566289/references": fx("europepmc-references-25566289.json") });
    const r = await new CitationClient(http, { now: NOW }).network({ pmid: "25566289", doi: "10.3389/fpls.2014.00715" }, "references", 3);
    expect(http.calls[0]).toBe("https://www.ebi.ac.uk/europepmc/webservices/rest/MED/25566289/references?format=json&pageSize=3&page=1");
    expect(r).toMatchObject({ via: "europepmc", total: 42, unresolved: [] });
    expect(r.works.map((w) => w.pmid)).toEqual(["12788974", "22672649", "11842188"]);
    expect(r.works[1]).toMatchObject({ title: "Top 10 plant pathogenic bacteria in molecular plant pathology", year: 2012, venue: "Mol Plant Pathol", volume: "13", issue: "6", pages: "614-629" });
    expect(r.works[0]!.authors.slice(0, 4).map((a) => a.name)).toEqual(["Deslandes, L", "Olivier, J", "Peeters, N", "Feng, D X"]);
    expect(segsToText(formatReference(r.works[0]!, "apa-es"))).toMatch(/^Deslandes, L\., Olivier, J\., Peeters, N\., Feng, D\. X\.,/);
  });

  it("Europe PMC: quién cita el artículo, con nombres acentuados", async () => {
    const http = replay({ "/MED/25566289/citations": fx("europepmc-citations-25566289.json") });
    const r = await new CitationClient(http, { now: NOW }).network({ pmid: "25566289" }, "citations", 3);
    expect(r.total).toBe(87);
    expect(r.works.map((w) => [w.pmid, w.year])).toEqual([["42594154", 2026], ["42547877", 2026], ["42439467", 2026]]);
    expect(r.works[0]!.authors.map((a) => a.name)).toContain("Carrère, S");
    expect(r.works[0]!.landingUrl).toBe("https://europepmc.org/article/MED/42594154");
  });

  it("OpenCitations + Crossref: artículo solo con DOI (revista brasileña)", async () => {
    const http = replay({
      "opencitations.net/index/v2/citations/doi:10.14393/bj-v33n1a2017-36068": fx("opencitations-citations-bj36068.json"),
      "api.crossref.org/works?filter=doi%3A10.1016%2Fj.funbio.2017.08.006%2Cdoi%3A10.4025%2Factasciagron.v46i1.63370": fx("crossref-dois-citantes-bj36068.json"),
    });
    const r = await new CitationClient(http, { now: NOW }).network({ doi: "10.14393/BJ-V33N1A2017-36068" }, "citations");
    expect(r).toMatchObject({ via: "opencitations", total: 2, unresolved: [] });
    // Orden de OpenCitations; el PMID que trae OpenCitations se conserva
    expect(r.works.map((w) => [w.doi, w.pmid ?? null, w.year])).toEqual([
      ["10.1016/j.funbio.2017.08.006", "29029703", 2017],
      ["10.4025/actasciagron.v46i1.63370", null, 2023],
    ]);
    expect(r.works[1]!.authors[0]!.name).toBe("João Américo Wordell Filho");
  });

  it("Crossref bloquea un momento: se reintenta y, si sigue fallando, se muestra lo obtenido con un aviso", async () => {
    const oc = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ citing: `doi:10.1234/c${i}`, cited: "doi:10.1234/x" })));
    const item = (i: number) => ({ DOI: `10.1234/c${i}`, title: [`T${i}`], author: [], issued: { "date-parts": [[2020]] } });
    let calls = 0;
    const http = vi.fn(async (url: string) => {
      if (url.includes("opencitations")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => oc };
      calls++;
      // 1.ª consulta: error de red (como el bloqueo real de Crossref); 2.ª: responde el primer lote; lote 2: siempre falla
      if (calls === 1 || url.includes("c20")) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ message: { items: Array.from({ length: 20 }, (_, i) => item(i)) } }) };
    }) as unknown as HttpGet;
    const sleep = vi.fn(async () => undefined);
    const r = await new CitationClient(http, { sleep }).network({ doi: "10.1234/x" }, "citations");
    expect(r.works).toHaveLength(20);
    expect(r.unresolved).toHaveLength(5);
    expect(r.warning).toMatch(/^Crossref no completó 5 registros: No se pudo conectar con Crossref/);
    expect(sleep).toHaveBeenCalled();
  });

  it("sin citas registradas: lista vacía (respuesta real «[]»), sin inventar nada", async () => {
    const http = replay({ "citations/doi:10.1155/vmi/4160516": fx("opencitations-citations-vmi4160516.json") });
    const r = await new CitationClient(http).network({ doi: "10.1155/vmi/4160516" }, "citations");
    expect(r).toMatchObject({ works: [], total: 0, unresolved: [] });
    expect(http.calls).toHaveLength(1); // no consulta Crossref si no hay nada que completar
  });

  it("sin DOI ni PMID: error claro", async () => {
    await expect(new CitationClient(replay({})).network({ doi: null, pmid: null }, "references")).rejects.toThrow("no tiene DOI ni PMID");
  });

  it("utilidades", () => {
    expect(epmcAuthor("Mary-Huard T")).toBe("Mary-Huard, T");
    expect(epmcAuthor("Genin S")).toBe("Genin, S");
    expect(epmcAuthor("Consorcio Internacional")).toBe("Consorcio Internacional");
    expect(parseOpenCitations({ no: "lista" }, "citations")).toEqual([]);
  });
});

describe("historial de citas para el perfil", () => {
  it("con DOI: OpenCitations, años de las publicaciones que citan (respuesta real)", async () => {
    const http = replay({ "citations/doi:10.14393/bj-v33n1a2017-36068": fx("opencitations-citations-bj36068.json") });
    const h = await new CitationClient(http).citationHistory({ doi: "10.14393/bj-v33n1a2017-36068" });
    expect(h).toEqual({ via: "opencitations", total: 2, byYear: { "2017": 1, "2023": 1 } });
  });
  it("solo con PMID: Europe PMC; el total es el que informa la fuente aunque la lista venga recortada", async () => {
    const http = replay({ "/MED/25566289/citations": fx("europepmc-citations-25566289.json") });
    const h = await new CitationClient(http).citationHistory({ pmid: "25566289" });
    expect(h).toEqual({ via: "europepmc", total: 87, byYear: { "2026": 3 } });
  });
  it("sin citas registradas (respuesta real «[]»)", async () => {
    const http = replay({ "citations/doi:10.1155/vmi/4160516": fx("opencitations-citations-vmi4160516.json") });
    expect(await new CitationClient(http).citationHistory({ doi: "10.1155/vmi/4160516" })).toEqual({ via: "opencitations", total: 0, byYear: {} });
  });
});

describe("datos reales con valores nulos", () => {
  it("Europe PMC puede devolver null dentro de las palabras clave (PMID 30832079): no rompe la unión", async () => {
    const { parseEuropePmcWork, mergeResults } = await import("../src/index.ts");
    const r = JSON.parse(fx("europepmc-keyword-null-30832079.json")).resultList.result[0];
    const w = parseEuropePmcWork(r, "");
    expect(w.keywords).toEqual([]);
    // Aunque llegue un null por otra vía, la normalización lo descarta
    const raw = { ...w, keywords: ["Corn", null as unknown as string] };
    const merged = mergeResults([{ source: "europepmc", works: [raw] }, { source: "pubmed", works: [{ ...w, source: "pubmed" }] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.keywords).toEqual(["Corn"]);
    expect(merged[0]!.foundIn).toEqual(["europepmc", "pubmed"]);
  });
});

describe("tipo de estudio y método", () => {
  it("cláusulas con la sintaxis verificada de cada API", () => {
    expect(studyTypeClause(["meta", "sysrev"], "pubmed")).toBe("(meta-analysis[pt] OR systematic review[pt])");
    expect(studyTypeClause(["rct"], "epmc")).toBe('(PUB_TYPE:"Randomized Controlled Trial")');
    expect(studyTypeClause([], "epmc")).toBeNull();
    expect(methodClause("field")).toBe('("field trial" OR "field experiment" OR "field study" OR "field conditions")');
    expect(methodClause(null)).toBeNull();
  });
  it("se agregan a las URL de PubMed y Europe PMC", () => {
    const p = { text: "maize", filters: { studyTypes: ["meta" as const], method: "greenhouse" as const } };
    expect(decodeURIComponent(buildEsearchUrl(p).replace(/\+/g, " "))).toContain('term=((maize) AND (meta-analysis[pt])) AND (greenhouse OR glasshouse OR screenhouse OR "pot experiment")');
    expect(decodeURIComponent(buildEuropePmcUrl(p).replace(/\+/g, " "))).toContain('query=((maize) AND (PUB_TYPE:"Meta-Analysis")) AND (greenhouse OR glasshouse');
  });
  it("las fuentes que no los entienden se omiten y se informa", async () => {
    const mk = (id: FreeSource["id"]): FreeSource => ({ id, search: vi.fn(async () => ({ source: id, works: [], total: 0, url: "x" })) });
    const sources = [mk("pubmed"), mk("crossref"), mk("doaj")];
    const r = await searchSources(sources, { text: "maize", filters: { studyTypes: ["rct"] } });
    expect(r.outcomes.find((o) => o.source === "crossref")?.skipped).toBe("Crossref no permite filtrar por tipo de estudio ni por método");
    expect(sources[1]!.search).not.toHaveBeenCalled();
    expect(sources[0]!.search).toHaveBeenCalled();
  });
});
