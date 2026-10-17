import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonical, BIBLIO_FORMAT, BIBLIO_PROJECT, generateKeyPair, signText, SyncEngine } from "@biociencia/sync";
import type { Work } from "@biociencia/core";
import { BioRepo } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";
import { FolderTransport } from "@biociencia/sync/node";

/**
 * Dos computadoras comparten una carpeta: las publicaciones de la biblioteca de una
 * aparecen en la de la otra, con su PDF, sin duplicar nada. Una línea alterada después
 * de firmar se destruye (la firma ya no corresponde); importar dos veces no duplica.
 */

const trabajo: Work = {
  title: "Crop rotation systems and Stenocarpella ear rot incidence",
  authors: [{ name: "Flett B C" }],
  year: 2001,
  venue: "Plant disease",
  doi: "10.1094/pdis.2001.85.1.92",
  source: "openalex",
  fetchedAt: "2026-10-14T10:00:00Z",
};

let dir: string;
let folder: string;
const closers: (() => void)[] = [];

interface Node {
  repo: BioRepo;
  engine: SyncEngine;
  t: FolderTransport;
}

async function node(name: string): Promise<Node> {
  const driver = createNodeDriver(join(dir, `${name}.sqlite`));
  closers.push(() => driver.close());
  const repo = new BioRepo(driver);
  await repo.init();
  await repo.ensureIdentity(name, `PC de ${name}`);
  const engine = new SyncEngine(repo);
  return { repo, engine, t: new FolderTransport(folder) };
}

const PDF_B64 = Buffer.from("%PDF-1.4 documento de prueba", "utf8").toString("base64");
const PDF_SHA = "8888";

describe("biblioteca compartida (misma carpeta, sin servidores)", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "biociencia-biblio-"));
    folder = join(dir, "carpeta");
    mkdirSync(folder);
  });
  afterEach(() => {
    for (const c of closers.splice(0)) c();
    rmSync(dir, { recursive: true, force: true });
  });

  it("comparte publicaciones nuevas una sola vez y acepta PDFs; lo repetido no duplica", async () => {
    const a = await node("Ana");
    const b = await node("Bruno");

    // Ana guarda un trabajo en su biblioteca y lo comparte
    const { id } = await a.repo.upsertWork(trabajo);
    await a.repo.addToLibrary(id);
    await a.repo.addAttachment({ workId: id, filename: "articulo.pdf", base64: PDF_B64, size: 26, sha256: PDF_SHA, pages: 1, text: "texto del pdf" });
    expect(await a.engine.shareLibrary(a.t, { includePdfs: true })).toBe(1);
    // Compartir de nuevo no repite nada
    expect(await a.engine.shareLibrary(a.t, { includePdfs: true })).toBe(0);

    // Bruno importa: su biblioteca pasa de 0 a 1 con el PDF
    const r = await b.engine.pullLibrary(b.t);
    expect(r.imported).toBe(1);
    expect(r.attachments).toBe(1);
    expect(await b.repo.libraryCount()).toBe(1);
    const entries = await b.repo.listLibrary({});
    expect(entries[0]!.work.doi).toBe(trabajo.doi);
    expect(await b.repo.listAttachments(entries[0]!.work.id!)).toHaveLength(1);

    // Importar otra vez no duplica nada
    const r2 = await b.engine.pullLibrary(b.t);
    expect(r2.imported).toBe(0);
    expect(r2.merged).toBe(1);
    expect((await b.repo.listLibrary({})).length).toBe(1);
  });

  it("una línea alterada después de firmar se descarta", async () => {
    const b = await node("Bruno");
    // Línea con formato legítimo: firma su llave propia sobre un título, y luego CAMBIA el título
    const kp = await generateKeyPair();
    const payload = { format: BIBLIO_FORMAT, createdAt: "2026-10-16T00:00:00Z", work: { title: "Título original firmado", authors: [], source: "openalex", fetchedAt: "2026-10-14T10:00:00Z" } as Work, attachments: [] };
    const sig = await signText(signedStringPublic("intruso", payload), kp.secretKey);
    const device = `0J8${"A".repeat(23)}`; // ULID válido solo para la prueba del intruso
    const alterado = { v: 1, from: device, name: "Intruso", key: kp.publicKey, sig, payload: { ...payload, work: { ...payload.work, title: "Título manipulado" } } };
    await b.t.append(BIBLIO_PROJECT, device, JSON.stringify(alterado) + "\n");
    const r = await b.engine.pullLibrary(b.t);
    expect(r.invalid).toBe(1);
    expect(r.imported).toBe(0);
    expect(await b.repo.libraryCount()).toBe(0);
  });
});

/** Igual a la cadena firmada por el módulo de biblioteca (se copia aqui para la prueba de alteración). */
function signedStringPublic(from: string, payload: unknown): string {
  return `${BIBLIO_FORMAT}|${from}|${canonical(payload)}`;
}
