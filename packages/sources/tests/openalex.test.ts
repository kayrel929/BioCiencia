import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  abstractFromInvertedIndex, buildFilter, buildWorksUrl, OpenAlexClient, OpenAlexError,
  parseOpenAlexWork, prepareQuery, type HttpGet,
} from "../src/index.ts";

/**
 * Las respuestas de tests/fixtures son respuestas REALES de api.openalex.org
 * capturadas el 2026-10-14 desde el navegador del usuario (la nube de desarrollo
 * no tiene acceso a OpenAlex). Aquí se reproducen sin conexión para probar el
 * análisis de datos; la prueba en vivo está en tests/live.
 */
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const SEARCH = fx("openalex-search-stenocarpella.json");
const DOI = fx("openalex-doi-ijms12095522.json");

function replay(status: number, body: string, headers: Record<string, string> = {}): HttpGet {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
  }));
}

describe("análisis de respuestas reales", () => {
  it("convierte una búsqueda en publicaciones con DOI, revista, tipo y fuente", async () => {
    const http = replay(200, SEARCH, { "x-ratelimit-cost-usd": "0.001", "x-ratelimit-remaining-usd": "0.098" });
    const c = new OpenAlexClient(http, { now: () => new Date("2026-10-14T16:00:00Z") });
    const r = await c.searchWorks({ text: "Stenocarpella macrospora maize", perPage: 5 });
    expect(r.total).toBe(345);
    expect(r.works).toHaveLength(5);
    expect(r.costUsd).toBe(0.001);
    expect(r.remainingUsd).toBe(0.098);
    const tpp = r.works.find((w) => w.doi === "10.1007/s40858-016-0079-3")!;
    expect(tpp).toMatchObject({ venue: "Tropical Plant Pathology", type: "article", year: 2016, source: "openalex", openalexId: "W2307903383" });
    expect(tpp.fetchedAt).toBe("2026-10-14T16:00:00.000Z");
    const thesis = r.works.find((w) => w.openalexId === "W7120728006")!;
    expect(thesis.doi).toBeNull();
    expect(thesis.type).toBe("dissertation");
    expect(thesis.abstract && thesis.abstract.length).toBeGreaterThan(50);
    for (const w of r.works) {
      expect(w.title.length).toBeGreaterThan(5);
      expect(w.authors.every((a) => a.name.length > 0)).toBe(true);
    }
  });

  it("lee un artículo por DOI con resumen reconstruido, autores con ORCID y PMID", async () => {
    const http = replay(200, DOI);
    const c = new OpenAlexClient(http);
    const w = (await c.getByDoi("https://doi.org/10.3390/IJMS12095522"))!;
    expect(http).toHaveBeenCalledWith(expect.stringContaining("/works/doi:10.3390/ijms12095522?"), expect.anything());
    expect(w.doi).toBe("10.3390/ijms12095522");
    expect(w.title).toMatch(/^Isolation of Bacteria with Antifungal Activity/);
    expect(w.venue).toBe("International Journal of Molecular Sciences");
    expect(w.abstract).toMatch(/Stenocarpella maydis and Stenocarpella macrospora are the causal agents/);
    expect(w.pmid).toMatch(/^\d+$/);
    expect(w.authors[0]?.name).toMatch(/Petat/);
    expect(w.isOpenAccess).toBe(true);
  });

  it("DOI inexistente devuelve null y DOI mal escrito da error claro", async () => {
    const c = new OpenAlexClient(replay(404, '{"error":"404"}'));
    expect(await c.getByDoi("10.9999/no-existe")).toBeNull();
    await expect(c.getByDoi("hola")).rejects.toThrow(/formato válido/);
  });

  it("reconstruye el resumen desde el índice invertido", () => {
    expect(abstractFromInvertedIndex({ maize: [2], ear: [3], Diplodia: [0], causes: [1] })).toBe("Diplodia causes maize ear");
    expect(abstractFromInvertedIndex(null)).toBeNull();
  });

  it("no inventa campos ausentes", () => {
    const w = parseOpenAlexWork({ id: "https://openalex.org/W1", title: "X" }, "2026-01-01T00:00:00Z");
    expect(w).toMatchObject({ doi: null, venue: null, abstract: null, citedByCount: null, isOpenAccess: null, authors: [] });
  });
});

describe("construcción de consultas (sintaxis verificada en la API real)", () => {
  it("filtros de año, acceso abierto y tipo", () => {
    expect(buildFilter({ yearFrom: 2020, yearTo: 2025, openAccess: true, type: "article" })).toEqual([
      "publication_year:2020-2025", "is_oa:true", "type:article",
    ]);
    expect(buildFilter({ yearFrom: 2020 })).toEqual(["publication_year:>2019"]);
    expect(buildFilter({ yearTo: 2010 })).toEqual(["publication_year:<2011"]);
  });
  it("autor, revista, idioma, citas y área", () => {
    expect(buildFilter({ authorId: "https://openalex.org/A5057456807", sourceId: "S9265444", language: "es", minCitations: 10, domainId: "1" })).toEqual([
      "language:es", "cited_by_count:>9", "primary_topic.domain.id:1", "authorships.author.id:A5057456807", "primary_location.source.id:S9265444",
    ]);
  });
  it("ignora valores que podrían alterar la consulta", () => {
    expect(buildFilter({ type: "article,is_oa:false", language: "español", authorId: "S1", domainId: "1,2" })).toEqual([]);
  });
  it("búsqueda por título usa title.search y limpia comas", () => {
    const url = new URL(buildWorksUrl({ text: "Ralstonia, solanacearum: wilt", mode: "title" }));
    expect(url.searchParams.get("filter")).toBe("title.search:Ralstonia solanacearum wilt");
    expect(url.searchParams.has("search")).toBe(false);
  });
  it("orden, paginación, campos y correo de contacto", () => {
    const url = new URL(buildWorksUrl({ text: "Trichoderma", sort: "cited", page: 3, perPage: 500 }, { mailto: "a@b.ec" }));
    expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("per-page")).toBe("100");
    expect(url.searchParams.get("select")).toContain("abstract_inverted_index");
    expect(url.searchParams.get("mailto")).toBe("a@b.ec");
  });
});

describe("preparación de la pregunta", () => {
  it("detecta DOI en cualquier formato", () => {
    expect(prepareQuery("https://doi.org/10.1094/PHP-06-23-0060-RS")).toMatchObject({ kind: "doi", doi: "10.1094/php-06-23-0060-rs" });
  });
  it("de una pregunta conserva los términos científicos", () => {
    const q = prepareQuery("¿Qué microorganismos muestran mayor eficacia contra Ralstonia solanacearum?");
    expect(q.kind).toBe("question");
    expect(q.simplified).toBe(true);
    expect(q.text).toBe("microorganismos Ralstonia solanacearum");
  });
  it("no toca consultas con operadores booleanos o comillas", () => {
    const t = '(Trichoderma OR Bacillus) AND Ralstonia NOT tomato';
    expect(prepareQuery(t)).toEqual({ kind: "keywords", text: t, simplified: false });
    expect(prepareQuery('"Stenocarpella macrospora" maíz').kind).toBe("keywords");
  });
  it("palabras clave simples pasan sin cambios", () => {
    expect(prepareQuery("  Trichoderma   banano ")).toEqual({ kind: "keywords", text: "Trichoderma banano", simplified: false });
  });
});

describe("errores y costo", () => {
  it("límite de uso (429) con mensaje en español", async () => {
    const c = new OpenAlexClient(replay(429, '{"error":"rate limit"}'));
    await expect(c.searchWorks({ text: "x" })).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/límite de uso/) });
  });
  it("400 muestra el motivo que da OpenAlex", async () => {
    const body = JSON.stringify({ error: "Invalid query parameters error.", message: "publication_yearX is not a valid field." });
    const c = new OpenAlexClient(replay(400, body));
    await expect(c.searchWorks({ text: "x" })).rejects.toThrow(/publication_yearX is not a valid field/);
  });
  it("sin conexión", async () => {
    const c = new OpenAlexClient(vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await c.searchWorks({ text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(OpenAlexError);
    expect(err.message).toMatch(/conexión a internet/);
  });
  it("tiempo de espera agotado", async () => {
    const slow: HttpGet = (_u, init) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const c = new OpenAlexClient(slow, { timeoutMs: 20 });
    await expect(c.searchWorks({ text: "x" })).rejects.toThrow(/no respondió a tiempo/);
  });
  it("la misma consulta no se paga dos veces en 10 minutos", async () => {
    const http = replay(200, SEARCH);
    const c = new OpenAlexClient(http);
    await c.searchWorks({ text: "Stenocarpella" });
    await c.searchWorks({ text: "Stenocarpella" });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("el correo de contacto no aparece en la URL que se guarda", async () => {
    const c = new OpenAlexClient(replay(200, SEARCH), { mailto: "investigador@iniap.gob.ec" });
    const r = await c.searchWorks({ text: "Stenocarpella" });
    expect(r.url).not.toContain("iniap");
  });
});
