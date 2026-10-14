import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Work } from "@biociencia/core";
import { BioRepo, MIGRATIONS, toFtsQuery } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

// Metadatos tomados de registros públicos reales (DOI verificables), usados solo como datos de prueba.
const anderson: Work = {
  title: "Prevalence of Stenocarpella maydis and Stenocarpella macrospora causing Diplodia ear rot in Kentucky",
  authors: [{ name: "Nolan R. Anderson" }],
  year: 2023,
  venue: "Plant Health Progress",
  doi: "10.1094/php-06-23-0060-rs",
  source: "openalex",
  fetchedAt: "2026-10-14T10:00:00Z",
};
const petatan: Work = {
  title: "Isolation of Bacteria with Antifungal Activity against the Phytopathogenic Fungi Stenocarpella maydis and Stenocarpella macrospora",
  authors: [{ name: "Iván Petatán-Sagahón" }],
  year: 2011,
  venue: "International Journal of Molecular Sciences",
  doi: "10.3390/ijms12095522",
  abstract: "Bacillus subtilis, Pseudomonas spp. and Pantoea agglomerans showed antifungal activity.",
  source: "openalex",
  fetchedAt: "2026-10-14T10:00:00Z",
};

let dir: string;
let repo: BioRepo;
let driver: ReturnType<typeof createNodeDriver>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "biociencia-"));
  driver = createNodeDriver(join(dir, "biociencia.db"));
  repo = new BioRepo(driver);
  await repo.init();
  await repo.ensureIdentity("Christopher");
});
afterEach(() => {
  driver.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("migraciones", () => {
  it("se aplican una sola vez", async () => {
    expect(await repo.init()).toEqual([]);
    const v = await driver.all<{ version: number }>("SELECT version FROM schema_migrations");
    expect(v.map((x) => x.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });
  it("una transacción fallida no deja datos a medias", async () => {
    await expect(
      driver.batch([
        { sql: "INSERT INTO settings (key, value) VALUES ('a', '1')" },
        { sql: "INSERT INTO tabla_inexistente VALUES (1)" },
      ]),
    ).rejects.toThrow();
    expect(await repo.getSetting("a")).toBeNull();
  });
});

describe("publicaciones y duplicados", () => {
  it("el mismo DOI escrito distinto se guarda una sola vez y se completa", async () => {
    const a = await repo.upsertWork(anderson);
    const b = await repo.upsertWork({ ...anderson, doi: "https://doi.org/10.1094/PHP-06-23-0060-RS", abstract: "Kentucky corn fields were surveyed in 2019 and 2020.", source: "crossref" });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect(await repo.countWorks()).toBe(1);
    const w = await repo.getWork(a.id);
    expect(w?.abstract).toContain("Kentucky");
    expect((await repo.workSources(a.id)).map((s) => s.source).sort()).toEqual(["crossref", "openalex"]);
  });
  it("reconoce un artículo por OpenAlex aunque la segunda vez traiga DOI", async () => {
    const a = await repo.upsertWork({ ...petatan, doi: null, openalexId: "W2001" });
    const b = await repo.upsertWork({ ...petatan, openalexId: "https://openalex.org/W2001" });
    expect(b.id).toBe(a.id);
    // y ahora también por DOI
    expect((await repo.upsertWork({ ...petatan, openalexId: null })).id).toBe(a.id);
  });
  it("sin identificadores detecta duplicados por título, año y autor", async () => {
    const x = { title: "Control biológico de Ralstonia", authors: [{ name: "María Pérez" }], year: 2024, source: "manual" as const, fetchedAt: "2026-10-14T00:00:00Z" };
    const a = await repo.upsertWork(x);
    const b = await repo.upsertWork({ ...x, title: "CONTROL BIOLOGICO DE RALSTONIA" });
    expect(b.id).toBe(a.id);
  });
});

describe("historial de búsquedas", () => {
  it("guarda la búsqueda, sus resultados en orden y los errores", async () => {
    const { searchId } = await repo.saveSearch({ query: "Stenocarpella", source: "openalex", results: [anderson, petatan, anderson], totalHits: 133, filters: { yearFrom: 2010 } });
    const list = await repo.listSearches();
    expect(list[0]).toMatchObject({ id: searchId, query: "Stenocarpella", resultCount: 2, totalHits: 133, filters: { yearFrom: 2010 } });
    expect((await repo.searchResults(searchId)).map((w) => w.doi)).toEqual([anderson.doi, petatan.doi]);
    await repo.saveSearch({ query: "x", source: "openalex", results: [], error: "HTTP 503" });
    expect((await repo.listSearches())[0]?.error).toBe("HTTP 503");
  });
});

describe("biblioteca", () => {
  it("busca sin acentos ni mayúsculas, con prefijos, solo en lo guardado", async () => {
    const a = await repo.upsertWork(anderson);
    const p = await repo.upsertWork(petatan);
    await repo.addToLibrary(a.id);
    await repo.addToLibrary(p.id);
    await repo.upsertWork({ ...anderson, doi: "10.9999/no-guardado", title: "Stenocarpella no guardado" });
    expect((await repo.listLibrary({ text: "stenocarp" })).length).toBe(2);
    expect((await repo.listLibrary({ text: "ivan petatan" })).map((e) => e.work.doi)).toEqual([petatan.doi]);
    expect((await repo.listLibrary({ text: "PANTOEA" })).length).toBe(1);
    expect(await repo.listLibrary({ text: '"); DROP TABLE works; --' })).toEqual([]);
  });
  it("favoritos, etiquetas, notas y quitar de la biblioteca", async () => {
    const a = await repo.upsertWork(anderson);
    await repo.addToLibrary(a.id);
    await repo.setFavorite(a.id, true);
    await repo.addTag(a.id, "maíz");
    await repo.setLibraryNotes(a.id, "Comparar con nuestro reporte en Ecuador");
    const [e] = await repo.listLibrary({ favorite: true, tag: "maíz" });
    expect(e).toMatchObject({ favorite: true, tags: ["maíz"], notes: "Comparar con nuestro reporte en Ecuador" });
    await repo.removeFromLibrary(a.id);
    expect(await repo.libraryCount()).toBe(0);
    expect(await repo.getWork(a.id)).not.toBeNull(); // el artículo sigue en el historial
  });
  it("colecciones", async () => {
    const a = await repo.upsertWork(anderson);
    const c = await repo.createCollection("Diplodia");
    await repo.addToCollection(c, a.id);
    expect((await repo.listCollections())[0]).toMatchObject({ name: "Diplodia", itemCount: 1 });
    expect((await repo.listLibrary({ collectionId: c })).length).toBe(1);
  });
});

describe("proyectos", () => {
  it("se crean con su creador como administrador y conservan los datos al reabrir", async () => {
    const id = await repo.createProject({ name: "Control biológico de Ralstonia mediante Trichoderma", objectives: "Evaluar 5 cepas" });
    const a = await repo.upsertWork(petatan);
    await repo.addWorkToProject(id, a.id);
    await repo.updateProject(id, { description: "Ensayo en invernadero" });
    driver.close();
    driver = createNodeDriver(join(dir, "biociencia.db"));
    repo = new BioRepo(driver);
    await repo.init();
    const p = await repo.getProject(id);
    expect(p).toMatchObject({ name: "Control biológico de Ralstonia mediante Trichoderma", objectives: "Evaluar 5 cepas", description: "Ensayo en invernadero" });
    expect(await repo.myRole(id)).toBe("admin");
    expect((await repo.listLibrary({ projectId: id })).length).toBe(1);
    expect((await repo.listProjects())[0]?.workCount).toBe(1);
  });
  it("un usuario que no es miembro no ve ni modifica el proyecto", async () => {
    const id = await repo.createProject({ name: "Privado" });
    // Simula un proyecto de otra persona: se quita la membresía local
    await driver.batch([{ sql: "DELETE FROM project_members WHERE project_id = ?", params: [id] }]);
    expect(await repo.getProject(id)).toBeNull();
    expect(await repo.listProjects()).toEqual([]);
    await expect(repo.updateProject(id, { name: "x" })).rejects.toThrow(/permiso/);
  });
  it("un lector no puede editar", async () => {
    const id = await repo.createProject({ name: "Compartido" });
    await driver.batch([{ sql: "UPDATE project_members SET role = 'reader' WHERE project_id = ?", params: [id] }]);
    await expect(repo.updateProject(id, { name: "Cambio" })).rejects.toThrow(/permiso/);
    await expect(repo.deleteProject(id)).rejects.toThrow(/permiso/);
  });
});

describe("toFtsQuery", () => {
  it("escapa la entrada del usuario", () => {
    expect(toFtsQuery("Trichoderma harzianum")).toBe('"Trichoderma"* "harzianum"*');
    expect(toFtsQuery('a" OR 1')).toBe('"a"* "OR"* "1"*');
    expect(toFtsQuery("  ;; ")).toBeNull();
  });
});
