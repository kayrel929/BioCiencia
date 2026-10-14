import { describe, expect, it } from "vitest";
import { parseRIS, toRIS, type Work } from "@biociencia/core";
import { BACKUP_TABLES, BioRepo, MIGRATIONS } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const w: Work = {
  title: "Survival of Stenocarpella spp. in maize debris and soil",
  authors: [{ name: "Pinto, F." }],
  year: 2023,
  doi: "10.1000/ejemplo-biociencia-1",
  abstract: "Biología del patógeno en rastrojo",
  source: "manual",
  fetchedAt: "2026-10-14T00:00:00Z",
};

async function fresh() {
  const driver = createNodeDriver();
  const repo = new BioRepo(driver);
  await repo.init();
  return { driver, repo };
}

describe("copias de seguridad", () => {
  it("ida y vuelta completa a otra base vacía (como pasar de Windows a web)", async () => {
    const a = await fresh();
    await a.repo.ensureIdentity("Christopher");
    const { id } = await a.repo.upsertWork(w);
    await a.repo.addToLibrary(id);
    await a.repo.addTag(id, "maíz");
    const pid = await a.repo.createProject({ name: "Diplodia en Orellana", objectives: "Incidencia" });
    await a.repo.addWorkToProject(pid, id);
    await a.repo.addNote("project", pid, "Muestreo en noviembre");
    await a.repo.saveSearch({ query: "Stenocarpella", source: "openalex", results: [w], totalHits: 1 });
    const backup = JSON.parse(JSON.stringify(await a.repo.exportBackup())); // como si se guardara en un archivo
    expect(backup.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(Object.keys(backup.tables)).toEqual([...BACKUP_TABLES]);

    const b = await fresh();
    const r = await b.repo.restoreBackup(backup);
    expect(r.rows).toBeGreaterThan(10);
    expect((await b.repo.getIdentity())?.displayName).toBe("Christopher");
    expect(await b.repo.getProject(pid)).toMatchObject({ name: "Diplodia en Orellana", objectives: "Incidencia" });
    expect((await b.repo.listNotes("project", pid))[0]?.body).toBe("Muestreo en noviembre");
    const lib = await b.repo.listLibrary({ text: "biologia rastrojo" }); // índice de texto reconstruido
    expect(lib.map((e) => e.tags)).toEqual([["maíz"]]);
    expect((await b.repo.listSearches()).length).toBe(1);
  });

  it("si la restauración falla, los datos actuales quedan intactos", async () => {
    const a = await fresh();
    await a.repo.ensureIdentity("Actual");
    await a.repo.addToLibrary((await a.repo.upsertWork(w)).id);
    const bad = await a.repo.exportBackup();
    bad.tables.works = [{ id: "x" }]; // falta el título obligatorio → la transacción falla
    await expect(a.repo.restoreBackup(bad)).rejects.toThrow();
    expect(await a.repo.libraryCount()).toBe(1);
    expect((await a.repo.getIdentity())?.displayName).toBe("Actual");
  });

  it("rechaza archivos que no son copias o de versiones más nuevas", async () => {
    const a = await fresh();
    await expect(a.repo.restoreBackup({ hola: 1 })).rejects.toThrow(/no es una copia/);
    const b = await a.repo.exportBackup();
    await expect(a.repo.restoreBackup({ ...b, schemaVersion: 999 })).rejects.toThrow(/más nueva/);
  });
});

describe("importación a la biblioteca", () => {
  it("cuenta nuevas y existentes, y las agrega a colección y proyecto", async () => {
    const a = await fresh();
    await a.repo.ensureIdentity("Christopher");
    await a.repo.upsertWork(w); // ya existía
    const ris = toRIS([w, { ...w, title: "Otro artículo", doi: "10.1000/ejemplo-biociencia-2" }]);
    const parsed = parseRIS(ris).works;
    const col = await a.repo.createCollection("Importadas");
    const pid = await a.repo.createProject({ name: "P" });
    const r = await a.repo.importWorks(parsed, { collectionId: col, projectId: pid });
    expect(r).toMatchObject({ created: 1, merged: 1 });
    expect(await a.repo.libraryCount()).toBe(2);
    expect((await a.repo.listLibrary({ collectionId: col })).length).toBe(2);
    expect((await a.repo.listLibrary({ projectId: pid })).length).toBe(2);
    expect((await a.repo.worksByIds(r.ids)).map((x) => x.doi)).toEqual(["10.1000/ejemplo-biociencia-1", "10.1000/ejemplo-biociencia-2"]);
  });
});
