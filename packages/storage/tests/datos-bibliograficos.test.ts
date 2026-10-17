import { describe, expect, it } from "vitest";
import { citationKeys } from "@biociencia/core";
import { BioRepo } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const at = "2026-10-15T00:00:00Z";

describe("datos bibliográficos (volumen, número, páginas)", () => {
  it("guarda volumen, número y páginas de cada publicación", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    const { id } = await repo.upsertWork({ title: "Artículo", authors: [{ name: "Ana Torres" }], year: 2021, doi: "10.1234/a", volume: "12", issue: "9", pages: "5522-5537", source: "crossref", fetchedAt: at });
    expect(await repo.getWork(id)).toMatchObject({ volume: "12", issue: "9", pages: "5522-5537" });
    // Una fuente sin esos datos no borra los que ya había
    await repo.upsertWork({ title: "Artículo", authors: [{ name: "Ana Torres" }], year: 2021, doi: "10.1234/a", source: "doaj", fetchedAt: at });
    expect(await repo.getWork(id)).toMatchObject({ volume: "12", issue: "9", pages: "5522-5537" });
  });

  it("las claves de cita no cambian al agregar otra publicación a la biblioteca", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    const add = async (doi: string, title: string) => {
      const { id } = await repo.upsertWork({ title, authors: [{ name: "Ana Torres" }], year: 2021, doi, source: "crossref", fetchedAt: at });
      await repo.addToLibrary(id);
    };
    await add("10.1234/1", "Riego del maíz");
    await add("10.1234/2", "Riego del frijol");
    const before = citationKeys(await repo.libraryWorksStable());
    await add("10.1234/3", "Riego del arroz");
    const after = citationKeys(await repo.libraryWorksStable());
    expect(after.slice(0, 2)).toEqual(before);
    expect(new Set(after).size).toBe(3);
  });
});
