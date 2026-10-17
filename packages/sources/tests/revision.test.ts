import { describe, expect, it, vi } from "vitest";
import type { ReviewQuestion, Work } from "@biociencia/core";
import { PubMedClient, runReviewSearch, SourceError, type FreeSearchParams, type FreeSource, type HttpGet } from "../src/index.ts";

const q: ReviewQuestion = { question: "", framework: "libre", concepts: [{ name: "a", terms: ["maize"] }, { name: "b", terms: ["Stenocarpella"] }] };
const w = (doi: string): Work => ({ title: `T ${doi}`, authors: [], year: 2020, doi, source: "manual", fetchedAt: "" });

/** Fuente de prueba que pagina una lista fija y registra las consultas recibidas. */
function fake(id: FreeSource["id"], all: Work[], fail = false) {
  const calls: FreeSearchParams[] = [];
  const s: FreeSource = {
    id,
    search: vi.fn(async (p: FreeSearchParams) => {
      calls.push(p);
      if (fail) throw new Error(`${id} no responde`);
      const per = p.perPage ?? 100;
      const start = ((p.page ?? 1) - 1) * per;
      return { source: id, works: all.slice(start, start + per), total: all.length, url: "x" };
    }),
  };
  return { s, calls };
}

describe("búsqueda de la revisión", () => {
  it("cada fuente recibe su estrategia, se pagina hasta el máximo y se unen repetidos", async () => {
    const pm = fake("pubmed", Array.from({ length: 250 }, (_, i) => w(`10.1234/${i}`)));
    const ep = fake("europepmc", [w("10.1234/0"), w("10.1234/1"), w("10.9999/x")]);
    const cr = fake("crossref", [w("10.1234/2")]);
    const r = await runReviewSearch([pm.s, ep.s, cr.s], q, { maxPerSource: 150 });
    expect(pm.calls.map((c) => [c.page, c.perPage])).toEqual([[1, 100], [2, 100]]);
    expect(pm.calls[0]!.text).toBe('"maize"[tiab] AND "Stenocarpella"[tiab]');
    expect(ep.calls[0]!.text).toBe('TITLE_ABS:"maize" AND TITLE_ABS:"Stenocarpella"');
    expect(cr.calls[0]!.text).toBe("maize Stenocarpella");
    expect(r.runs.map((x) => [x.source, x.found, x.retrieved])).toEqual([["pubmed", 250, 150], ["europepmc", 3, 3], ["crossref", 1, 1]]);
    // 150 + 3 + 1 = 154 recuperados; 10.1234/0, 10.1234/1 y 10.1234/2 repetidos → 151 únicos
    expect(r.works).toHaveLength(151);
    expect(r.works.find((x) => x.doi === "10.1234/0")?.foundIn).toEqual(["pubmed", "europepmc"]);
  });

  it("una fuente que ignora la paginación (repite la misma página) no genera un ciclo", async () => {
    const same = [w("10.1234/p"), w("10.1234/q")];
    const s: FreeSource = { id: "europepmc", search: vi.fn(async () => ({ source: "europepmc" as const, works: same, total: 178, url: "x" })) };
    const r = await runReviewSearch([s], q, { maxPerSource: 500 });
    expect(s.search).toHaveBeenCalledTimes(2);
    expect(r.runs[0]).toMatchObject({ found: 178, retrieved: 2 });
  });

  it("una fuente que falla no detiene las demás; el filtro de tipo de estudio omite Crossref y DOAJ", async () => {
    const pm = fake("pubmed", [w("10.1234/a")]);
    const ep = fake("europepmc", [], true);
    const cr = fake("crossref", [w("10.1234/b")]);
    const r = await runReviewSearch([pm.s, ep.s, cr.s], q, { filters: { studyTypes: ["meta"] } });
    expect(r.runs.find((x) => x.source === "europepmc")?.error).toBe("europepmc no responde");
    expect(r.runs.find((x) => x.source === "crossref")?.skipped).toMatch(/no permite filtrar por tipo de estudio/);
    expect(cr.s.search).not.toHaveBeenCalled();
    expect(pm.calls[0]!.filters?.studyTypes).toEqual(["meta"]);
    expect(r.works.map((x) => x.doi)).toEqual(["10.1234/a"]);
  });

  it("si una fuente bloquea por exceso de consultas, se reintenta una vez", async () => {
    let n = 0;
    const s: FreeSource = {
      id: "pubmed",
      search: vi.fn(async () => {
        if (n++ === 0) throw new SourceError("pubmed", "No se pudo conectar con PubMed.", null);
        return { source: "pubmed" as const, works: [w("10.1234/r")], total: 1, url: "x" };
      }),
    };
    const sleep = vi.fn(async () => undefined);
    const r = await runReviewSearch([s], q, { sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(r.runs[0]).toMatchObject({ retrieved: 1, error: null });
  });

  it("PubMed espacia sus consultas (límite de 3 por segundo de NCBI)", async () => {
    const times: number[] = [];
    const http = vi.fn(async (url: string) => {
      times.push(Date.now());
      const body = url.includes("esearch") ? JSON.stringify({ esearchresult: { count: "1", idlist: ["1"] } }) : "<PubmedArticleSet></PubmedArticleSet>";
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
    }) as unknown as HttpGet;
    const c = new PubMedClient(http, { minIntervalMs: 120 });
    await Promise.all([c.search({ text: "a" }), c.search({ text: "b" })]);
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(110);
  });
});
