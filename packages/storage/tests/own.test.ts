import { describe, expect, it } from "vitest";
import { BioRepo } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const w = (doi: string, title: string, year: number) => ({ title, authors: [{ name: "Christopher Suárez" }], year, doi, source: "orcid" as const, fetchedAt: "2026-10-15T00:00:00Z" });

describe("publicaciones propias", () => {
  it("se importan sin duplicar, quedan en la biblioteca y se pueden filtrar", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Christopher Suárez");
    // Ya tenía uno de sus artículos en la biblioteca (vino de una búsqueda)
    const prev = await repo.upsertWork({ ...w("10.1234/abc", "Artículo A", 2024), source: "crossref" });
    const r = await repo.importOwnWorks([{ ...w("10.1234/abc", "Artículo A", 2024), putCode: "11" }, { ...w("10.1234/def", "Artículo B", 2026), putCode: "12" }], "0000-0002-1825-0097");
    expect(r).toMatchObject({ created: 1, merged: 1 });
    expect(r.ids[0]).toBe(prev.id);
    // Importar otra vez no duplica
    await repo.importOwnWorks([{ ...w("10.1234/abc", "Artículo A", 2024), putCode: "11" }], "0000-0002-1825-0097");
    expect((await repo.listOwnWorks()).map((x) => [x.title, x.origin])).toEqual([["Artículo B", "orcid"], ["Artículo A", "orcid"]]);
    expect(await repo.libraryCount()).toBe(2);
    const other = await repo.upsertWork({ ...w("10.1234/zzz", "Ajeno", 2020), source: "crossref" });
    await repo.addToLibrary(other.id);
    expect((await repo.listLibrary({ own: true })).map((e) => e.work.title).sort()).toEqual(["Artículo A", "Artículo B"]);
    // Marcar y desmarcar a mano
    await repo.setOwnWork(other.id, true);
    expect((await repo.ownWorkIds([other.id])).has(other.id)).toBe(true);
    await repo.setOwnWork(other.id, false);
    expect((await repo.ownWorkIds()).size).toBe(2);
    // La copia de seguridad las conserva
    const b = await repo.exportBackup();
    expect(b.tables.own_works).toHaveLength(2);
  });
});
