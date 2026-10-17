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

describe("historial de citas de las publicaciones propias", () => {
  it("se guarda, se reemplaza y entra en la copia de seguridad", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    const { id } = await repo.upsertWork(w("10.1234/cit", "Con citas", 2020));
    await repo.saveCitationHistory(id, "opencitations", { total: 5, byYear: { "2022": 2, "2024": 3 } });
    await repo.saveCitationHistory(id, "opencitations", { total: 6, byYear: { "2022": 2, "2024": 3, "2025": 1 } });
    await repo.setSetting("scopus_api_key", "abcdef0123456789abcdef0123456789");
    await repo.setSetting("scopus_author_id", "57190000000");
    expect(await repo.listCitationHistories()).toMatchObject([{ workId: id, source: "opencitations", total: 6, byYear: { "2025": 1 } }]);
    const other = new BioRepo(createNodeDriver());
    await other.init();
    await other.restoreBackup(JSON.parse(JSON.stringify(await repo.exportBackup())));
    expect((await other.listCitationHistories())[0]?.total).toBe(6);
    // La clave de Scopus no viaja en la copia; el Author ID (dato público) sí
    expect(await other.getSetting("scopus_api_key")).toBeNull();
    expect(await other.getSetting("scopus_author_id")).toBe("57190000000");
  });
});
