import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encryptText, manuscriptDocx, parseMarkdown, processCitations, ulid, type Work } from "@biociencia/core";
import { anovaOneWay, tukeyHsd } from "@biociencia/stats";
import { BioRepo } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";
import { generateKeyPair, projectIdFor, replayProject, signEvent, verifyEventSignature, type SyncEvent } from "@biociencia/sync";

/**
 * Mediciones REALES de rendimiento en la máquina donde se ejecuta (Fase 11).
 * Los datos son sintéticos y se generan aquí (no son publicaciones reales): solo sirven para medir volumen.
 * Los límites son amplios (para no fallar en una PC lenta); el objetivo es detectar regresiones graves.
 * Resultado: tests/perf/resultado.json y una tabla en la consola.
 */

const rows: { prueba: string; cantidad: string; ms: number; limite_ms: number }[] = [];
async function measure<T>(prueba: string, cantidad: string, limite: number, fn: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t0);
  rows.push({ prueba, cantidad, ms, limite_ms: limite });
  expect(ms, prueba).toBeLessThan(limite);
  return r;
}

const WORDS = "maize ear rot fungal pathogen yield soil nematode banana cacao coffee rice resistance biocontrol trichoderma bacillus field trial ecuador amazon disease".split(" ");
let s = 7;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = () => WORDS[Math.floor(rnd() * WORDS.length)]!;
const fakeWork = (i: number): Work => ({
  title: `Sintético ${i}: ${Array.from({ length: 8 }, pick).join(" ")}`,
  authors: Array.from({ length: 1 + (i % 6) }, (_, j) => ({ name: `Nombre${j} Apellido${(i * 7 + j) % 900}` })),
  year: 1990 + (i % 36),
  venue: `Revista ${i % 120}`,
  volume: String(i % 40),
  pages: `${i % 300}-${(i % 300) + 12}`,
  doi: `10.99999/sintetico.${i}`,
  abstract: Array.from({ length: 120 }, pick).join(" "),
  source: "manual",
  fetchedAt: "2026-10-15T00:00:00Z",
});

describe("rendimiento", () => {
  it("biblioteca de 5 000 publicaciones: guardar, buscar, copia de seguridad", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Medición");
    await measure("Guardar publicaciones en la biblioteca", "5 000", 60_000, async () => {
      for (let i = 0; i < 5000; i++) {
        const { id } = await repo.upsertWork(fakeWork(i));
        await repo.addToLibrary(id);
      }
    });
    {
      const t0 = performance.now();
      let n = 0;
      for (let i = 0; i < 50; i++) n += (await repo.listLibrary({ text: `${pick()} ${pick()}`, limit: 50 })).length;
      const avg = Math.round(((performance.now() - t0) / 50) * 10) / 10;
      rows.push({ prueba: "Búsqueda de texto completo (promedio por consulta)", cantidad: "50 consultas sobre 5 000", ms: avg, limite_ms: 250 });
      expect(n).toBeGreaterThan(0);
      expect(avg).toBeLessThan(250);
    }
    await measure("Abrir la biblioteca (primera página)", "5 000", 1_000, () => repo.listLibrary({ limit: 50 }));
    const backup = await measure("Crear copia de seguridad", "5 000 publicaciones", 10_000, () => repo.exportBackup());
    const json = JSON.stringify(backup);
    await measure(`Cifrar copia (${(json.length / 1e6).toFixed(1)} MB, PBKDF2 600 000)`, "1 copia", 20_000, () => encryptText(json, "contraseña de medición"));
    const other = new BioRepo(createNodeDriver());
    await other.init();
    await measure("Restaurar copia de seguridad", "5 000 publicaciones", 60_000, () => other.restoreBackup(JSON.parse(json)));
    expect(await other.libraryCount()).toBe(5000);
  });

  it("sincronización: firmar, verificar y reproducir 2 000 eventos", async () => {
    const k = await generateKeyPair();
    const project = projectIdFor(k.publicKey, Date.UTC(2026, 9, 15));
    const base = { v: 1 as const, project, author: "AUTOR", authorKey: k.publicKey, device: "DISP" };
    const hlc = (n: number) => `${String(Date.UTC(2026, 9, 15) + n).padStart(13, "0")}-00000-DISP`;
    const events: SyncEvent[] = await measure("Firmar eventos (Ed25519)", "2 000", 30_000, async () => {
      const out: SyncEvent[] = [await signEvent({ ...base, id: ulid(1), hlc: hlc(0), type: "project.create", data: { name: "P", description: "", objectives: "", ownerName: "A" } }, k.secretKey)];
      for (let i = 1; i < 2000; i++) {
        const w = fakeWork(i);
        out.push(await signEvent({ ...base, id: ulid(1 + i), hlc: hlc(i), type: i % 4 ? "work.add" : "note.add", data: i % 4 ? { key: `doi:${w.doi}`, work: w } : { noteId: ulid(), body: `nota ${i}` } }, k.secretKey));
      }
      return out;
    });
    await measure("Verificar firmas", "2 000", 30_000, async () => {
      for (const e of events) expect(await verifyEventSignature(e)).toBe(true);
    });
    const r = await measure("Reproducir el proyecto (estado final)", "2 000 eventos", 5_000, () => replayProject([...events].reverse()));
    expect(r.rejected).toHaveLength(0);
    expect(r.state?.works.length).toBe(1500);
  });

  it("estadística y editor con datos grandes", async () => {
    const y: number[] = [];
    const g: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      g.push(`T${i % 20}`);
      y.push(5 + (i % 20) * 0.1 + rnd());
    }
    const a = await measure("ANOVA de una vía + Tukey", "20 000 datos, 20 tratamientos", 5_000, () => {
      const r = anovaOneWay(y, g);
      return tukeyHsd(y, g, r.mse, r.dfError);
    });
    expect(a).toBeDefined();
    const lib = new Map<string, Work>(Array.from({ length: 500 }, (_, i) => [`k${i}`, fakeWork(i)]));
    const text = Array.from({ length: 2000 }, (_, i) => `## Sección ${i}\n\nPárrafo con **datos** y *cursivas* [@k${i % 500}; @k${(i * 7) % 500}].`).join("\n\n");
    const c = await measure("Procesar citas APA", "2 000 citas, 500 referencias", 5_000, () => processCitations(text, lib, "apa-es"));
    expect(c.references).toHaveLength(500);
    const bytes = await measure("Generar Word (.docx)", "4 000 párrafos + 500 referencias", 5_000, () =>
      manuscriptDocx({ title: "Medición", blocks: parseMarkdown(c.text), references: c.references }),
    );
    rows[rows.length - 1]!.cantidad += ` (${(bytes.length / 1e6).toFixed(1)} MB)`;
  });

  afterAll(() => {
    const info = { fecha: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model ?? "?", nucleos: cpus().length, memoria_gb: Math.round(totalmem() / 1e9), mediciones: rows };
    writeFileSync(join(__dirname, "resultado.json"), JSON.stringify(info, null, 2) + "\n");
    console.table(rows);
    console.log(`Node ${info.node} · ${info.cpu} · ${info.nucleos} núcleos · ${info.memoria_gb} GB`);
  });
});
