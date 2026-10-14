import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BioRepo } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";
import { parseOpenAlexWork } from "../src/index.ts";

// Respuesta real de OpenAlex (ver openalex.test.ts)
const results = JSON.parse(readFileSync(join(__dirname, "fixtures", "openalex-search-stenocarpella.json"), "utf8")).results;
const doiWork = JSON.parse(readFileSync(join(__dirname, "fixtures", "openalex-doi-ijms12095522.json"), "utf8"));

describe("búsqueda → base de datos local", () => {
  it("guarda resultados reales, conserva el orden y no duplica al repetir la búsqueda", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Prueba");
    const works = results.map((r: unknown) => parseOpenAlexWork(r, "2026-10-14T16:00:00Z"));
    const first = await repo.saveSearch({ query: "Stenocarpella macrospora maize", source: "openalex", results: works, totalHits: 345 });
    expect(first.ids).toHaveLength(5);
    const again = await repo.saveSearch({ query: "Stenocarpella macrospora maize", source: "openalex", results: works, totalHits: 345 });
    expect(again.ids).toEqual(first.ids);
    expect(await repo.countWorks()).toBe(5);
    expect((await repo.searchResults(first.searchId)).map((w) => w.openalexId)).toEqual(works.map((w: { openalexId: string }) => w.openalexId));

    // El mismo artículo llegando por DOI y luego por búsqueda se reconoce
    const byDoi = parseOpenAlexWork(doiWork, "2026-10-14T16:01:00Z");
    const a = await repo.upsertWork(byDoi);
    const b = await repo.upsertWork({ ...byDoi, doi: null }); // solo con ID de OpenAlex
    expect(b.id).toBe(a.id);

    // La biblioteca encuentra el resumen real sin internet
    await repo.addToLibrary(a.id);
    expect((await repo.listLibrary({ text: "Pantoea agglomerans" })).length).toBe(1);
  });
});
