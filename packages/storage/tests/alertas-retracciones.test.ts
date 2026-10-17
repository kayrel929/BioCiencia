import { describe, expect, it } from "vitest";
import type { Work } from "@biociencia/core";
import { BioRepo } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const w = (doi: string, title: string, extra: Partial<Work> = {}): Work => ({ title, authors: [{ name: "Ana Pérez" }], year: 2025, doi, source: "crossref", fetchedAt: "2026-10-15T00:00:00Z", ...extra });

async function fresh() {
  const repo = new BioRepo(createNodeDriver());
  await repo.init();
  await repo.ensureIdentity("Christopher");
  return repo;
}

describe("alertas de búsquedas", () => {
  it("lo visto al seguir no cuenta; lo nuevo se guarda una sola vez", async () => {
    const repo = await fresh();
    const id = await repo.createAlert({ query: "Stenocarpella maize", label: "Stenocarpella", baseline: [w("10.1234/a", "A"), w("10.1234/b", "B")] });
    expect(await repo.createAlert({ query: "Stenocarpella maize", baseline: [] })).toBe(id); // no se duplica
    const r1 = await repo.recordAlertCheck(id, [w("10.1234/a", "A"), w("10.1234/c", "C nuevo"), w("10.1234/d", "D nuevo")]);
    expect(r1.newIds).toHaveLength(2);
    const r2 = await repo.recordAlertCheck(id, [w("10.1234/c", "C nuevo"), w("10.1234/b", "B")]);
    expect(r2.newIds).toEqual([]);
    const [a] = await repo.listAlerts();
    expect(a).toMatchObject({ label: "Stenocarpella", unseen: 2, lastNew: 0 });
    expect((await repo.alertItems(id)).map((x) => x.work.title).sort()).toEqual(["C nuevo", "D nuevo"]);
    await repo.markAlertSeen(id);
    expect((await repo.listAlerts())[0]!.unseen).toBe(0);
    await repo.deleteAlert(id);
    expect(await repo.listAlerts()).toEqual([]);
  });
});

describe("retracciones y tipos de publicación", () => {
  it("se guardan, se combinan y se pueden actualizar", async () => {
    const repo = await fresh();
    const { id } = await repo.upsertWork(w("10.1234/r", "Retractado", { pubTypes: ["Journal Article"] }));
    await repo.upsertWork(w("10.1234/r", "Retractado", { pubTypes: ["Retracted Publication"], retraction: { status: "retracted", source: "pubmed" }, source: "europepmc" }));
    expect(await repo.getWork(id)).toMatchObject({ pubTypes: ["Journal Article", "Retracted Publication"], retraction: { status: "retracted" } });
    // Una fuente que no sabe de la retractación no la borra
    await repo.upsertWork(w("10.1234/r", "Retractado", { source: "doaj" }));
    expect((await repo.getWork(id))!.retraction).toMatchObject({ status: "retracted" });
    await repo.setRetractions([{ workId: id, retraction: { status: "retracted", noticeDoi: "10.1/aviso", date: "2020-01-01", source: "crossref" } }]);
    expect((await repo.getWork(id))!.retraction).toMatchObject({ noticeDoi: "10.1/aviso" });
    expect(await repo.getSetting("retractions_checked_at")).toBeTruthy();
  });
});
