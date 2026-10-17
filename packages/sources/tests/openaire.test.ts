import { describe, expect, it } from "vitest";
import { buildOpenaireUrl, OpenaireClient, openaireQuery, parseOpenaireWork, SourceError, type HttpGet } from "../src/index.ts";

/** Respuesta simulada del servicio (sin salir a internet). */
function httpReturning(status: number, body: string) {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    return { ok: status < 300, status, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet;
  return { http, calls };
}

/** Un resultado tal como lo envía OpenAIRE (recortado a lo que se usa). */
const RESULTADO = {
  metadata: {
    "oaf:entity": {
      "oaf:result": {
        title: { "@classid": "main title", "$": "Efficacy of Biocontrol Agent (BCA) Trichoderma spp." },
        creator: [
          { "@rank": "1", "@name": "Zill e", "@surname": "Huma", "$": "Zill e Huma" },
          { "@rank": "2", "$": "null Pratibha Sharma" },
          { "@rank": "3" },
        ],
        pid: [
          { "@classid": "doi", "$": "10.55627/PBULLETIN.001.01.0126" },
          { "@classid": "pmid", "$": 24906124 },
        ],
        measure: [
          { "@id": "popularity", "@score": "3.3839505E-9" },
          { "@id": "citationCount", "@score": "3" },
        ],
        bestaccessright: { "@classid": "OPEN", "@classname": "Open Access" },
        dateofacceptance: { "$": "2022-12-31" },
        description: { "$": "<jats:p>Se estudió <i>Trichoderma</i> en papa.</jats:p>" },
        language: { "@classid": "eng", "@classname": "English" },
        children: {
          result: [
            {
              "@objidentifier": "doi_________::x",
              instance: {
                hostedby: { "@name": "African Journal of Biotechnology", "@id": "doajarticles::x" },
                url: { "$": "https://doi.org/10.55627/pbulletin.001.01.0126" },
              },
            },
          ],
        },
      },
    },
  },
};

describe("OpenAIRE (repositorios y tesis de todo el mundo)", () => {
  it("limpia la consulta y une las palabras con Y", () => {
    expect(openaireQuery("trichoderma biocontrol")).toBe("trichoderma biocontrol");
    expect(openaireQuery('trichoderma (biocontrol) "suelo"')).toBe("trichoderma biocontrol suelo");
  });

  it("arma la dirección con años, acceso abierto y orden por citas", () => {
    const u = buildOpenaireUrl({ text: "trichoderma biocontrol", filters: { yearFrom: 2015, yearTo: 2020, openAccess: true }, sort: "cited", page: 2, perPage: 20 });
    expect(u).toContain("https://api.openaire.eu/search/publications?");
    expect(u).toContain("keywords=trichoderma+biocontrol");
    expect(u).toContain("format=json");
    expect(u).toContain("size=20");
    expect(u).toContain("page=2");
    expect(u).toContain("fromDateAccepted=2015-01-01");
    expect(u).toContain("toDateAccepted=2020-12-31");
    expect(u).toContain("OA=true");
    expect(u).toContain("sortBy=popularity%2Cdescending");
    // Sin filtros no se añaden
    const simple = buildOpenaireUrl({ text: "trichoderma" });
    expect(simple).not.toContain("fromDateAccepted");
    expect(simple).not.toContain("OA=true");
    expect(simple).not.toContain("sortBy");
    // El máximo del servicio es 50 por página
    expect(buildOpenaireUrl({ text: "x", perPage: 500 })).toContain("size=50");
  });

  it("pide alguna palabra antes de consultar", () => {
    expect(() => buildOpenaireUrl({ text: "  " })).toThrow(SourceError);
    expect(() => buildOpenaireUrl({ text: "  " })).toThrow(/palabra/i);
  });

  it("lee una ficha: título, autores, año, DOI, PMID, citas, revista y enlace", () => {
    const w = parseOpenaireWork(RESULTADO, "2026-10-17T00:00:00Z");
    expect(w).toMatchObject({
      title: "Efficacy of Biocontrol Agent (BCA) Trichoderma spp.",
      year: 2022,
      doi: "10.55627/pbulletin.001.01.0126",
      pmid: "24906124",
      venue: "African Journal of Biotechnology",
      citedByCount: 3,
      isOpenAccess: true,
      language: "en",
      landingUrl: "https://doi.org/10.55627/pbulletin.001.01.0126",
      source: "openaire",
    });
    // Se quita el «null » que antepone OpenAIRE y se descartan los autores sin nombre
    expect(w.authors).toEqual([{ name: "Zill e Huma" }, { name: "Pratibha Sharma" }]);
    expect(w.abstract).toContain("Se estudió Trichoderma en papa.");
  });

  it("se conforma con lo que venga: sin revista, sin acceso abierto y sin hijos", () => {
    const sinNada = {
      metadata: {
        "oaf:entity": {
          "oaf:result": {
            title: [{ "$": "Un artículo de repositorio" }, { "$": "Otro título" }],
            creator: { "$": "Ana Torres" },
            pid: { "@classid": "doi", "$": "10.3390/plants14010001" },
            bestaccessright: { "@classid": "UNKNOWN", "@classname": "unspecified" },
          },
        },
      },
    };
    const w = parseOpenaireWork(sinNada, "2026-10-17T00:00:00Z");
    expect(w).toMatchObject({
      title: "Un artículo de repositorio",
      venue: null,
      isOpenAccess: false,
      citedByCount: null,
      doi: "10.3390/plants14010001",
      landingUrl: "https://doi.org/10.3390/plants14010001",
    });
    expect(w.authors).toEqual([{ name: "Ana Torres" }]);
    expect(w.year).toBeNull();
  });

  it("no se rompe si el resultado viene vacío", () => {
    expect(parseOpenaireWork({}, "x")).toMatchObject({ title: "(sin título)", authors: [], source: "openaire" });
  });

  it("la búsqueda devuelve la lista y el total", async () => {
    const body = JSON.stringify({ response: { header: { total: { $: "5455" } }, results: { result: RESULTADO } } });
    const { http, calls } = httpReturning(200, body);
    const r = await new OpenaireClient(http).search({ text: "trichoderma", perPage: 10 });
    expect(r.source).toBe("openaire");
    expect(r.total).toBe(5455);
    expect(r.works).toHaveLength(1);
    expect(r.works[0]).toMatchObject({ source: "openaire", pmid: "24906124" });
    expect(calls[0]).toContain("/search/publications?");
  });

  it("devuelve cero resultados sin fallar cuando no hay nada", async () => {
    const body = JSON.stringify({ response: { header: { total: { $: "0" } }, results: null } });
    const { http } = httpReturning(200, body);
    const r = await new OpenaireClient(http).search({ text: "zzzqqq", perPage: 10 });
    expect(r).toEqual({ source: "openaire", works: [], total: 0, url: expect.any(String) });
  });
});
