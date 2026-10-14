import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Work } from "@biociencia/core";
import { BioRepo } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";
import { decodeResearcherCode, replayProject, signEvent, SyncEngine, type SyncEvent } from "@biociencia/sync";
import { FolderTransport } from "@biociencia/sync/node";

/**
 * SIMULACIÓN de dos computadoras en un solo entorno: cada "nodo" tiene su propia base de datos
 * SQLite en disco y ambos comparten una carpeta (como la que copiaría Syncthing entre dos PC).
 * Esto NO sustituye la prueba real con dos computadoras Windows (ver docs/SINCRONIZACION.md).
 */

// Metadatos de publicaciones reales (DOI verificables), usados como datos de prueba.
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
  setTime(ms: number): void;
}

async function node(name: string, startMs = Date.UTC(2026, 9, 14, 12)): Promise<Node> {
  const driver = createNodeDriver(join(dir, `${name}.sqlite`));
  closers.push(() => driver.close());
  const repo = new BioRepo(driver);
  await repo.init();
  await repo.ensureIdentity(name, `PC de ${name}`);
  let now = startMs;
  const engine = new SyncEngine(repo, () => now++);
  await engine.attach();
  return { repo, engine, t: new FolderTransport(folder), setTime: (ms) => (now = ms) };
}

async function sharedProject(a: Node, b: Node, role: "editor" | "reader" = "editor") {
  const pid = await a.repo.createProject({ name: "Diplodia en Orellana", description: "Pudrición de mazorca" });
  const w = await a.repo.upsertWork(anderson);
  await a.repo.addWorkToProject(pid, w.id);
  await a.engine.shareProject(pid);
  await a.engine.addMember(pid, await b.engine.researcherCode(), role);
  await a.engine.syncNow(a.t);
  await b.engine.syncNow(b.t);
  return pid;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bc-2nodos-"));
  folder = join(dir, "carpeta-sincronizada");
});
afterEach(() => {
  while (closers.length) closers.pop()!();
  rmSync(dir, { recursive: true, force: true });
});

describe("sincronización entre dos nodos simulados", () => {
  it("un proyecto compartido llega completo a la otra computadora", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);

    const pb = await b.repo.getProject(pid);
    expect(pb?.name).toBe("Diplodia en Orellana");
    expect(pb?.visibility).toBe("shared");
    expect((await b.repo.listProjectWorks(pid)).map((w) => w.doi)).toEqual(["10.1094/php-06-23-0060-rs"]);
    expect(await b.repo.myRole(pid)).toBe("editor");
    expect((await b.repo.projectMembers(pid)).map((m) => m.displayName).sort()).toEqual(["Ana", "Christopher"]);
    // La biblioteca personal de B no se llena con los artículos del proyecto
    expect(await b.repo.libraryCount()).toBe(0);
    // Un archivo por computadora y proyecto
    expect(readdirSync(join(folder, pid))).toEqual([`${(await a.repo.getIdentity())!.deviceId}.ndjson`]);
  });

  it("cambios en ambos sentidos convergen al mismo estado", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);

    const wb = await b.repo.upsertWork(petatan);
    await b.repo.addWorkToProject(pid, wb.id);
    await b.repo.addNote("project", pid, "Revisar muestras de La Joya de los Sachas");
    await b.engine.syncNow(b.t);
    await a.engine.syncNow(a.t);

    for (const n of [a, b]) {
      expect((await n.repo.listProjectWorks(pid)).map((w) => w.doi).sort()).toEqual(["10.1094/php-06-23-0060-rs", "10.3390/ijms12095522"]);
      expect((await n.repo.listNotes("project", pid)).map((x) => x.body)).toEqual(["Revisar muestras de La Joya de los Sachas"]);
    }
    expect(await a.engine.projectState(pid)).toEqual(await b.engine.projectState(pid));
  });

  it("ediciones simultáneas del mismo campo: gana la más reciente (HLC) y la otra queda en el historial", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);

    // Sin conexión, cada uno cambia el nombre. B lo hace 1 minuto después.
    const t0 = Date.UTC(2026, 9, 14, 15);
    a.setTime(t0);
    b.setTime(t0 + 60_000);
    await a.repo.updateProject(pid, { name: "Nombre de Christopher" });
    await b.repo.updateProject(pid, { name: "Nombre de Ana" });
    await a.engine.syncNow(a.t);
    await b.engine.syncNow(b.t);
    await a.engine.syncNow(a.t);

    expect((await a.repo.getProject(pid))?.name).toBe("Nombre de Ana");
    expect((await b.repo.getProject(pid))?.name).toBe("Nombre de Ana");
    const h = await a.engine.history(pid);
    const loser = h.history.find((x) => x.summary.includes("Nombre de Christopher"));
    expect(loser?.superseded).toBe(true);
    expect(h.names[loser!.author]).toBe("Christopher");
    expect(await a.engine.projectState(pid)).toEqual(await b.engine.projectState(pid));
  });

  it("un lector no puede modificar: la app lo impide y un evento forzado se rechaza en todas las computadoras", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b, "reader");

    await expect(b.repo.updateProject(pid, { name: "Cambio no permitido" })).rejects.toThrow(/permiso/);

    // B intenta saltarse la interfaz: firma con su propia llave un evento y lo escribe en su archivo
    const me = (await b.repo.getIdentity())!;
    const keys = (await b.repo.getKeys())!;
    const forged = await signEvent(
      { v: 1, id: "01KPZZZZZZZZZZZZZZZZZZZZZZ", project: pid, author: me.id, authorKey: keys.publicKey, device: me.deviceId, hlc: `${Date.now() + 1000}-00000-${me.deviceId}`, type: "project.update", data: { field: "name", value: "Hackeado" } },
      keys.secretKey,
    );
    appendFileSync(join(folder, pid, `${me.deviceId}.ndjson`), JSON.stringify(forged) + "\n");
    const r = await a.engine.syncNow(a.t);
    expect(r.rejected).toBe(1);
    expect((await a.repo.getProject(pid))?.name).toBe("Diplodia en Orellana");
    const h = await a.engine.history(pid);
    expect(h.rejected).toContainEqual({ id: forged.id, reason: "Un lector no puede editar el proyecto" });
  });

  it("descarta eventos con firma falsificada o alterados después de firmar", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    const devA = (await a.repo.getIdentity())!.deviceId;
    const file = join(folder, pid, `${devA}.ndjson`);

    // Alguien edita el archivo de A en la carpeta y cambia el contenido de un evento ya firmado
    const lines = readFileSync(file, "utf8").trim().split("\n");
    const ev = JSON.parse(lines[0]!) as SyncEvent;
    const tampered = { ...ev, id: "01KPZZZZZZZZZZZZZZZZZZZZZY", data: { ...(ev.data as object), name: "Proyecto alterado" } };
    appendFileSync(file, JSON.stringify(tampered) + "\n");

    // Un tercero sin llave válida inventa un evento de administrador
    const fake = { ...ev, id: "01KPZZZZZZZZZZZZZZZZZZZZZX", type: "member.remove", data: { memberId: (await b.repo.getIdentity())!.id } };
    appendFileSync(file, JSON.stringify(fake) + "\n");
    appendFileSync(file, "esto no es json\n");

    const r = await b.engine.syncNow(b.t);
    expect(r.invalid).toBe(3);
    expect(r.fresh).toBe(0);
    expect(await b.repo.myRole(pid)).toBe("editor");
    expect((await b.repo.getProject(pid))?.name).toBe("Diplodia en Orellana");
  });

  it("quien no es miembro no ve el proyecto aunque reciba la carpeta", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const c = await node("Intruso");
    const pid = await sharedProject(a, b);
    await c.engine.syncNow(c.t);
    expect(await c.repo.getProject(pid)).toBeNull();
    expect(await c.repo.listProjects()).toEqual([]);
  });

  it("al retirar a un miembro, el proyecto deja de mostrarse en su computadora", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    expect(await b.repo.getProject(pid)).not.toBeNull();
    await a.engine.removeMember(pid, (await b.repo.getIdentity())!.id);
    await a.engine.syncNow(a.t);
    await b.engine.syncNow(b.t);
    expect(await b.repo.getProject(pid)).toBeNull();
  });

  it("una línea a medio copiar se ignora y se aplica en la siguiente sincronización", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    const devA = (await a.repo.getIdentity())!.deviceId;
    const file = join(folder, pid, `${devA}.ndjson`);

    await a.repo.updateProject(pid, { description: "Muestreo 2026" });
    await a.engine.syncNow(a.t);
    // Simular que Syncthing solo copió la mitad de la última línea
    const full = readFileSync(file, "utf8");
    const cut = full.slice(0, full.length - 40);
    writeFileSync(file, cut);
    const r1 = await b.engine.syncNow(b.t);
    expect(r1.partial).toBe(1);
    expect((await b.repo.getProject(pid))?.description).toBe("Pudrición de mazorca");
    writeFileSync(file, full);
    await b.engine.syncNow(b.t);
    expect((await b.repo.getProject(pid))?.description).toBe("Muestreo 2026");
  });

  it("sincronizar varias veces no duplica nada (idempotente)", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    const before = await b.repo.syncEventCounts();
    for (let i = 0; i < 3; i++) {
      const r = await b.engine.syncNow(b.t);
      expect(r.fresh).toBe(0);
      await a.engine.syncNow(a.t);
    }
    expect(await b.repo.syncEventCounts()).toEqual(before);
    expect(await b.repo.listProjectWorks(pid)).toHaveLength(1);
  });

  it("cambios hechos sin conexión por ambos se combinan al reconectar", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);

    const wa = await a.repo.upsertWork(petatan);
    await a.repo.addWorkToProject(pid, wa.id);
    await a.repo.updateProject(pid, { objectives: "Identificar especies" });
    const wb = (await b.repo.listProjectWorks(pid))[0]!;
    await b.repo.removeWorkFromProject(pid, wb.id!);
    await b.repo.addNote("project", pid, "Quitado: fuera de la región");

    await a.engine.syncNow(a.t);
    await b.engine.syncNow(b.t);
    await a.engine.syncNow(a.t);

    for (const n of [a, b]) {
      expect((await n.repo.listProjectWorks(pid)).map((w) => w.doi)).toEqual(["10.3390/ijms12095522"]);
      expect((await n.repo.getProject(pid))?.objectives).toBe("Identificar especies");
      expect(await n.repo.listNotes("project", pid)).toHaveLength(1);
    }
  });

  it("el mismo artículo con identificadores distintos en cada computadora no se duplica", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    // B tiene el artículo de Petatán con DOI y OpenAlex; A solo con DOI → mismas claves de DOI
    const wb = await b.repo.upsertWork({ ...petatan, openalexId: "W2025813436" });
    await b.repo.addWorkToProject(pid, wb.id);
    const wa = await a.repo.upsertWork(petatan);
    await a.repo.addWorkToProject(pid, wa.id);
    await a.engine.syncNow(a.t);
    await b.engine.syncNow(b.t);
    await a.engine.syncNow(a.t);
    for (const n of [a, b]) expect(await n.repo.listProjectWorks(pid)).toHaveLength(2);
  });

  it("paquete manual (versión web): exportar en A e importar en B", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await a.repo.createProject({ name: "Proyecto por paquete" });
    await a.engine.shareProject(pid);
    await a.engine.addMember(pid, await b.engine.researcherCode(), "editor");
    const bundle = await a.engine.exportBundle();
    const r = await b.engine.importBundle(bundle);
    expect(r.fresh).toBe(2);
    expect((await b.repo.getProject(pid))?.name).toBe("Proyecto por paquete");
    expect((await b.engine.importBundle(bundle)).fresh).toBe(0);
    await expect(b.engine.importBundle('{"hola":1}')).rejects.toThrow(/no es un paquete/);
  });

  it("el código de investigador contiene solo datos públicos", async () => {
    const a = await node("Christopher");
    const code = await a.engine.researcherCode();
    const c = decodeResearcherCode(code);
    const keys = (await a.repo.getKeys())!;
    expect(c).toEqual({ id: (await a.repo.getIdentity())!.id, name: "Christopher", key: keys.publicKey });
    expect(code).not.toContain(keys.secretKey);
    expect(atob(code.slice(4).replace(/-/g, "+").replace(/_/g, "/"))).not.toContain(keys.secretKey);
    expect(() => decodeResearcherCode("hola")).toThrow(/BC1-/);
  });

  it("el resultado no depende del orden en que llegan los eventos", async () => {
    const a = await node("Christopher");
    const b = await node("Ana");
    const pid = await sharedProject(a, b);
    await b.repo.updateProject(pid, { name: "Otro nombre" });
    await b.engine.syncNow(b.t);
    await a.engine.syncNow(a.t);
    const events = (await a.repo.syncEventsRaw(pid)).map((r) => JSON.parse(r) as SyncEvent);
    const base = replayProject(events).state;
    for (let i = 0; i < 5; i++) {
      const shuffled = [...events].sort(() => Math.random() - 0.5);
      expect(replayProject(shuffled).state).toEqual(base);
    }
  });
});
