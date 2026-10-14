import { describe, expect, it } from "vitest";
import { OpenAlexClient, prepareQuery } from "@biociencia/sources";
import { BioRepo } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";

/**
 * Prueba EN VIVO contra api.openalex.org. Requiere internet.
 * Ejecutar en su PC con:  npm run test:live
 * Costo aproximado: 0,003 USD del cupo diario gratuito de OpenAlex.
 */
const client = new OpenAlexClient((url, init) => fetch(url, init), { mailto: process.env.BC_MAILTO ?? null, timeoutMs: 30_000 });

describe("OpenAlex en vivo", () => {
  it("una búsqueda devuelve resultados reales y se guardan en SQLite", async () => {
    const q = prepareQuery("¿Qué microorganismos muestran mayor eficacia contra Ralstonia solanacearum?");
    const r = await client.searchWorks({ text: q.text, perPage: 10 });
    console.log(`Consulta: ${r.url}\nTotal: ${r.total} · costo ${r.costUsd} USD · saldo del día ${r.remainingUsd} USD`);
    expect(r.total).toBeGreaterThan(0);
    expect(r.works.length).toBeGreaterThan(0);
    expect(r.works.every((w) => w.openalexId && w.title)).toBe(true);
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    const s = await repo.saveSearch({ query: q.text, source: "openalex", results: r.works, totalHits: r.total });
    expect((await repo.searchResults(s.searchId)).length).toBe(new Set(s.ids).size);
  }, 60_000);

  it("los filtros se aplican de verdad (año y acceso abierto)", async () => {
    const r = await client.searchWorks({ text: "Trichoderma banana", filters: { yearFrom: 2020, yearTo: 2025, openAccess: true }, perPage: 10 });
    expect(r.works.length).toBeGreaterThan(0);
    for (const w of r.works) {
      expect(w.year).toBeGreaterThanOrEqual(2020);
      expect(w.year).toBeLessThanOrEqual(2025);
      expect(w.isOpenAccess).toBe(true);
    }
  }, 60_000);

  it("búsqueda exacta por DOI y autocompletado de autores (gratuitos)", async () => {
    const w = await client.getByDoi("10.1094/php-06-23-0060-rs");
    expect(w?.title).toMatch(/Stenocarpella/);
    const authors = await client.autocompleteAuthors("Ricardo Trezzi Casa");
    expect(authors[0]?.id).toMatch(/^A\d+$/);
  }, 60_000);
});
