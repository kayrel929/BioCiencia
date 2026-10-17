import { describe, expect, it } from "vitest";
import type { Work } from "@biociencia/core";
import { BioRepo, MAX_PDF_BYTES } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

const w: Work = {
  title: "Survival of Stenocarpella spp. in maize debris and soil",
  authors: [{ name: "Pinto, F." }],
  year: 2023,
  doi: "10.1000/ejemplo-biociencia-1",
  source: "manual",
  fetchedAt: "2026-10-14T00:00:00Z",
};

async function fresh() {
  const repo = new BioRepo(createNodeDriver());
  await repo.init();
  await repo.ensureIdentity("Christopher");
  const { id } = await repo.upsertWork(w);
  await repo.addToLibrary(id);
  return { repo, id };
}

const pdf = { filename: "pinto 2023.pdf", base64: "JVBERi0xLjQK", size: 9, sha256: "a".repeat(64), pages: 3, text: "Los conidios de Stenocarpella sobrevivieron en el rastrojo durante dieciocho meses." };

describe("PDF adjuntos", () => {
  it("se guardan, no se duplican y su texto se encuentra al buscar en la biblioteca", async () => {
    const { repo, id } = await fresh();
    const r = await repo.addAttachment({ workId: id, ...pdf });
    expect(r.duplicate).toBe(false);
    expect((await repo.addAttachment({ workId: id, ...pdf })).duplicate).toBe(true);
    const list = await repo.listAttachments(id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filename: "pinto 2023.pdf", pages: 3, size: 9, annotationCount: 0 });
    expect(await repo.attachmentData(r.id)).toBe("JVBERi0xLjQK");
    // Palabra que solo está en el PDF (sin tilde, como la escribiría el usuario)
    expect((await repo.listLibrary({ text: "dieciocho meses" })).map((e) => e.work.id)).toEqual([id]);
    const [entry] = await repo.listLibrary();
    expect(entry!.pdfCount).toBe(1);
    expect((await repo.attachmentTexts([id])).get(id)).toContain("rastrojo");
    expect(await repo.pdfStorageSize()).toEqual({ count: 1, bytes: 9 });
  });
  it("rechaza archivos demasiado grandes y limpia nombres peligrosos", async () => {
    const { repo, id } = await fresh();
    await expect(repo.addAttachment({ workId: id, ...pdf, size: MAX_PDF_BYTES + 1 })).rejects.toThrow(/el máximo es 80 MB/);
    const r = await repo.addAttachment({ workId: id, ...pdf, filename: "..\\..\\a<b>.pdf" });
    expect((await repo.listAttachments(id))[0]!.filename).toBe(".._.._a_b_.pdf");
    await repo.deleteAttachment(r.id);
    expect(await repo.listAttachments(id)).toEqual([]);
    expect(await repo.listLibrary({ text: "dieciocho" })).toEqual([]);
  });
  it("subrayados con nota y color", async () => {
    const { repo, id } = await fresh();
    const { id: att } = await repo.addAttachment({ workId: id, ...pdf });
    const a1 = await repo.addAnnotation({ attachmentId: att, page: 2, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }], quote: "sobrevivieron en el rastrojo", note: "", color: "amarillo" });
    await repo.addAnnotation({ attachmentId: att, page: 1, rects: [], quote: "conidios", note: "Revisar", color: "verde" });
    await repo.updateAnnotation(a1, { note: "Dato clave para la discusión", color: "rosado" });
    const list = await repo.listAnnotations(att);
    expect(list.map((a) => [a.page, a.quote, a.note, a.color])).toEqual([
      [1, "conidios", "Revisar", "verde"],
      [2, "sobrevivieron en el rastrojo", "Dato clave para la discusión", "rosado"],
    ]);
    expect(list[1]!.rects).toEqual([{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }]);
    expect((await repo.listAttachments(id))[0]!.annotationCount).toBe(2);
    await repo.deleteAnnotation(a1);
    expect(await repo.listAnnotations(att)).toHaveLength(1);
  });
  it("la copia de seguridad lleva PDF, subrayados, estilos y grupos (o sin los PDF si se elige)", async () => {
    const a = await fresh();
    const { id: att } = await a.repo.addAttachment({ workId: a.id, ...pdf });
    await a.repo.addAnnotation({ attachmentId: att, page: 1, rects: [], quote: "conidios", note: "", color: "azul" });
    await a.repo.saveCslStyle("zootaxa", "Zootaxa", "<style/>", "descargado");
    await a.repo.saveSmartGroup({ name: "Con PDF", rules: { match: "all", rules: [{ field: "pdf", op: "yes" }] } });
    const full = await a.repo.exportBackup();
    const light = await a.repo.exportBackup({ includePdfs: false });
    expect(full.tables.attachment_data).toHaveLength(1);
    expect(light.tables.attachment_data).toEqual([]);

    const b = new BioRepo(createNodeDriver());
    await b.init();
    await b.restoreBackup(JSON.parse(JSON.stringify(full)));
    expect(await b.attachmentData(att)).toBe("JVBERi0xLjQK");
    expect(await b.listAnnotations(att)).toHaveLength(1);
    expect(await b.getCslStyle("zootaxa")).toBe("<style/>");
    expect((await b.listSmartGroups())[0]).toMatchObject({ name: "Con PDF", rules: { match: "all", rules: [{ field: "pdf", op: "yes" }] } });
    expect((await b.listLibrary({ text: "dieciocho" })).length).toBe(1); // índice del texto reconstruido
  });
});

describe("estilos y grupos inteligentes", () => {
  it("estilos guardados", async () => {
    const { repo } = await fresh();
    await repo.saveCslStyle("importado:mi", "Mi revista", "<style>1</style>", "importado");
    await repo.saveCslStyle("importado:mi", "Mi revista", "<style>2</style>", "importado");
    expect(await repo.getCslStyle("importado:mi")).toBe("<style>2</style>");
    expect((await repo.listCslStyles()).map((s) => [s.id, s.origin])).toEqual([["importado:mi", "importado"]]);
    await repo.deleteCslStyle("importado:mi");
    expect(await repo.getCslStyle("importado:mi")).toBeNull();
  });
  it("grupos: crear, editar, borrar", async () => {
    const { repo } = await fresh();
    await expect(repo.saveSmartGroup({ name: " ", rules: {} })).rejects.toThrow(/nombre/);
    const g = await repo.saveSmartGroup({ name: "Recientes", rules: { match: "all", rules: [] } });
    await repo.saveSmartGroup({ id: g, name: "Últimos 30 días", rules: { match: "all", rules: [{ field: "added", op: "within_days", value: "30" }] } });
    expect((await repo.listSmartGroups()).map((x) => x.name)).toEqual(["Últimos 30 días"]);
    await repo.deleteSmartGroup(g);
    expect(await repo.listSmartGroups()).toEqual([]);
  });
});
