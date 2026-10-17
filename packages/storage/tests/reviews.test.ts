import { describe, expect, it } from "vitest";
import { BioRepo } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const w = (doi: string, title: string) => ({ title, authors: [{ name: "Ana Torres" }], year: 2020, doi, source: "pubmed" as const, fetchedAt: "2026-10-15T00:00:00Z" });

describe("revisiones de literatura", () => {
  it("guarda registros sin duplicar, conserva decisiones al repetir la búsqueda y entra en la copia", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Christopher Suárez");
    const id = await repo.saveReview({ title: "Resistencia a Stenocarpella", question: { question: "¿?", framework: "peo", concepts: [] }, filters: { yearFrom: 2000 } });
    const runs = [{ source: "pubmed", label: "PubMed", found: 2, retrieved: 2, query: "q" }];
    expect(await repo.setReviewResults(id, runs, [{ ...w("10.1234/a", "A"), foundIn: ["pubmed"] }, { ...w("10.1234/b", "B"), foundIn: ["pubmed", "europepmc"] }])).toEqual({ added: 2, kept: 0 });
    let recs = await repo.listReviewRecords(id);
    expect(recs.map((r) => [r.work.title, r.decision, r.foundIn])).toEqual([["A", "pending", ["pubmed"]], ["B", "pending", ["pubmed", "europepmc"]]]);

    await expect(repo.setReviewDecision(id, recs[0]!.work.id!, "exclude")).rejects.toThrow("motivo");
    await repo.setReviewDecision(id, recs[0]!.work.id!, "exclude", "No trata el tema");
    await repo.setReviewDecision(id, recs[1]!.work.id!, "include");

    // Repetir la búsqueda con un resultado nuevo: no se pierden las decisiones
    expect(await repo.setReviewResults(id, runs, [w("10.1234/b", "B"), w("10.1234/c", "C"), w("10.1234/a", "A")])).toEqual({ added: 1, kept: 2 });
    recs = await repo.listReviewRecords(id);
    expect(recs.map((r) => [r.work.title, r.decision, r.reason])).toEqual([["B", "include", null], ["C", "pending", null], ["A", "exclude", "No trata el tema"]]);
    expect(await repo.listReviews()).toMatchObject([{ id, total: 3, included: 1, pending: 1 }]);
    expect((await repo.getReview(id))?.runs).toEqual(runs);
    // Los registros no entran solos a la biblioteca personal
    expect(await repo.libraryCount()).toBe(0);

    const other = new BioRepo(createNodeDriver());
    await other.init();
    await other.restoreBackup(JSON.parse(JSON.stringify(await repo.exportBackup())));
    expect((await other.listReviewRecords(id)).map((r) => r.decision)).toEqual(["include", "pending", "exclude"]);

    await repo.deleteReview(id);
    expect(await repo.listReviews()).toEqual([]);
  });

  it("al cambiar el identificador de un proyecto se lleva la revisión asociada", async () => {
    // Antes, «reviews» no se reasignaba y el DELETE final rompía la clave foránea:
    // compartir un proyecto con una revisión fallaba y el proyecto no se podía compartir.
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Christopher Suárez");
    const viejo = await repo.createProject({ name: "Tesis de maestría" });
    const revision = await repo.saveReview({ title: "Revisión", projectId: viejo, question: {}, filters: {} });
    const nuevo = "01J0000000000000000000000A";
    await repo.rekeyProject(viejo, nuevo);
    expect((await repo.getReview(revision))?.projectId).toBe(nuevo);
    expect((await repo.listReviews()).map((r) => r.projectId)).toEqual([nuevo]);
    expect(await repo.getProject(viejo)).toBeNull();
    expect((await repo.getProject(nuevo))?.name).toBe("Tesis de maestría");
  });
});
