import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkRetractions, crossrefRetraction, parseCrossrefWork, parseEuropePmcWork, type HttpGet } from "../src/index.ts";

/** Respuestas REALES grabadas el 2026-10-15 (ver fixtures/FUENTES.md): el artículo retractado de Wakefield (1998). */
const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const WAKEFIELD = "10.1016/s0140-6736(97)11096-0";
const THORAT = "10.1007/s00299-023-03114-6";

function replay(map: Record<string, string>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(decodeURIComponent(url.replace(/\+/g, " ")));
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 503, headers: { get: () => null }, text: async () => "no" };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => map[key]! };
  }) as unknown as HttpGet & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("retracciones", () => {
  it("Crossref «updated-by» (Retraction Watch): retractación con fecha y aviso", () => {
    const items = JSON.parse(fx("crossref-dois-retraccion-wakefield.json")).message.items;
    const w = parseCrossrefWork(items.find((i: any) => i.DOI.includes("97")), "");
    expect(w.retraction).toEqual({ status: "retracted", noticeDoi: "10.1016/s0140-6736(10)60175-4", date: "2010-02-06", source: "crossref" });
    expect(parseCrossrefWork(items.find((i: any) => i.DOI.includes("s00299")), "").retraction).toBeNull();
    expect(crossrefRetraction([{ type: "correction", DOI: "10.1/x" }])).toMatchObject({ status: "corrected" });
    expect(crossrefRetraction([{ type: "expression_of_concern" }, { type: "correction" }])).toMatchObject({ status: "concern" });
    expect(crossrefRetraction(undefined)).toBeNull();
  });
  it("Europe PMC / PubMed: tipo de publicación «Retracted Publication» (respuesta lite real)", () => {
    const r = JSON.parse(fx("europepmc-retractados-wakefield.json")).resultList.result[0];
    const w = parseEuropePmcWork(r, "");
    expect(w.retraction).toEqual({ status: "retracted", source: "pubmed" });
    expect(w.pubTypes).toEqual(["retracted publication", "research support, non-u.s. gov't", "journal article"]);
  });
  it("revisión por lotes: consulta Crossref y Europe PMC y combina", async () => {
    const http = replay({ "api.crossref.org": fx("crossref-dois-retraccion-wakefield.json"), "ebi.ac.uk": fx("europepmc-retractados-wakefield.json") });
    const r = await checkRetractions(http, [WAKEFIELD, THORAT, "doi.org/" + THORAT], { sleep: async () => {} });
    expect(r.errors).toEqual([]);
    expect(r.checked).toEqual(new Set([WAKEFIELD, THORAT]));
    expect(r.results.get(WAKEFIELD)).toMatchObject({ status: "retracted", source: "crossref", date: "2010-02-06" });
    expect(r.results.get(THORAT)).toBeNull();
    expect(http.calls.some((u) => u.includes('PUB_TYPE:"Retracted Publication"') && u.includes(`DOI:"${WAKEFIELD}"`))).toBe(true);
    expect(http.calls.some((u) => u.includes("updated-by"))).toBe(true); // se pide el campo
  });
  it("si una fuente no responde, se informa y no se da por revisado", async () => {
    const http = replay({ "ebi.ac.uk": fx("europepmc-retractados-wakefield.json") });
    const r = await checkRetractions(http, [WAKEFIELD, THORAT], { sleep: async () => {}, pauseMs: 0 });
    expect(r.errors.join(" ")).toMatch(/^Crossref:/);
    expect(r.checked).toEqual(new Set([WAKEFIELD])); // solo lo que Europe PMC confirmó
    expect(r.results.get(WAKEFIELD)).toMatchObject({ status: "retracted", source: "pubmed" });
  });
});
