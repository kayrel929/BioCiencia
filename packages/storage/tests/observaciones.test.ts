import { describe, expect, it } from "vitest";
import { BioRepo } from "../src/index.ts";
import { createNodeDriver } from "../src/node-driver.ts";

/**
 * Las observaciones de una publicación se pueden editar a mano (pantalla Biblioteca) y también se les
 * añade texto automáticamente (datos extraídos con IA, subrayados del PDF). Añadir NUNCA debe borrar
 * lo que el usuario había escrito.
 */
const work = {
  title: "Antagonismo de Trichoderma frente a Stenocarpella maydis",
  authors: [{ name: "Ana Torres" }],
  year: 2020,
  doi: "10.1234/observaciones",
  source: "pubmed" as const,
  fetchedAt: "2026-10-17T00:00:00Z",
};

async function repoConObra() {
  const repo = new BioRepo(createNodeDriver());
  await repo.init();
  await repo.ensureIdentity("Christopher Suárez");
  const { id } = await repo.upsertWork(work);
  return { repo, id };
}

const notasDe = async (repo: BioRepo, id: string) => (await repo.listLibrary()).find((e) => e.work.id === id)?.notes;

describe("añadir a las observaciones", () => {
  it("no borra lo que el usuario ya había escrito", async () => {
    const { repo, id } = await repoConObra();
    await repo.addToLibrary(id);
    await repo.setLibraryNotes(id, "Mi nota personal");
    await repo.appendLibraryNotes(id, "Datos extraídos con IA:\nPoblación: maíz");
    expect(await notasDe(repo, id)).toBe("Mi nota personal\n\nDatos extraídos con IA:\nPoblación: maíz");
  });

  it("si la publicación no estaba en la biblioteca, la añade y el texto no se pierde", async () => {
    const { repo, id } = await repoConObra();
    expect(await repo.isInLibrary(id)).toBe(false);
    await repo.appendLibraryNotes(id, "Subrayados del PDF");
    expect(await repo.isInLibrary(id)).toBe(true);
    expect(await notasDe(repo, id)).toBe("Subrayados del PDF");
  });

  it("texto vacío no añade nada", async () => {
    const { repo, id } = await repoConObra();
    await repo.appendLibraryNotes(id, "   ");
    expect(await repo.isInLibrary(id)).toBe(false);
  });
});
