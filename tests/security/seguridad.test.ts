import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  blocksToHtml, boundUlid, decryptText, documentXml, encryptText, formatReference, isBoundUlid, isEncryptedFile, manuscriptHtml,
  parseInline, parseMarkdown, parseReferences, passwordProblem, processCitations, redact, referencesHtml, sha256Hex, type Work,
} from "@biociencia/core";
import { parseTable } from "@biociencia/stats";
import { BioRepo, toFtsQuery } from "@biociencia/storage";
import { createNodeDriver } from "@biociencia/storage/node";
import { SyncEngine } from "@biociencia/sync";

/** Fase 11 — pruebas de seguridad. Todas se ejecutan sin red. */

const FAST = 100_000; // iteraciones mínimas aceptadas, para que las pruebas sean rápidas

describe("copias de seguridad cifradas", () => {
  it("cifra y descifra; el archivo no contiene el texto original", async () => {
    const secret = JSON.stringify({ secret_key: "302e020100300506032b657004220420" + "ab".repeat(32) });
    const f = await encryptText(secret, "una contraseña larga", FAST);
    expect(isEncryptedFile(f)).toBe(true);
    expect(JSON.stringify(f)).not.toContain("secret_key");
    expect(JSON.stringify(f)).not.toContain("abab");
    expect(await decryptText(f, "una contraseña larga")).toBe(secret);
  });

  it("contraseña incorrecta o archivo alterado: no se abre", async () => {
    const f = await encryptText("datos", "una contraseña larga", FAST);
    await expect(decryptText(f, "otra contraseña larga")).rejects.toThrow("Contraseña incorrecta o archivo dañado");
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    bytes[0]! ^= 1;
    await expect(decryptText({ ...f, data: btoa(String.fromCharCode(...bytes)) }, "una contraseña larga")).rejects.toThrow("Contraseña incorrecta o archivo dañado");
  });

  it("sal y vector aleatorios: dos copias iguales producen archivos distintos", async () => {
    const [a, b] = await Promise.all([encryptText("x", "una contraseña larga", FAST), encryptText("x", "una contraseña larga", FAST)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("rechaza contraseñas débiles y parámetros manipulados", async () => {
    expect(passwordProblem("corta")).toMatch(/al menos 10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetido/);
    expect(passwordProblem("maíz-Orellana-2026")).toBeNull();
    await expect(encryptText("x", "123")).rejects.toThrow(/al menos 10/);
    const f = await encryptText("x", "una contraseña larga", FAST);
    await expect(decryptText({ ...f, iterations: 1_000_000_000 }, "una contraseña larga")).rejects.toThrow("parámetros no válidos");
    await expect(decryptText({ ...f, iterations: 10 }, "una contraseña larga")).rejects.toThrow("parámetros no válidos");
  });

  it("copia real: la llave privada solo viaja cifrada y se restaura en otra computadora", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.ensureIdentity("Christopher Suárez");
    await new SyncEngine(repo).attach();
    const keys = (await repo.getKeys())!;
    const plain = JSON.stringify(await repo.exportBackup());
    expect(plain).toContain(keys.secretKey); // la copia sin cifrar sí la lleva (se advierte en pantalla)
    const enc = JSON.stringify(await encryptText(plain, "Diplodia-maydis-2026", FAST));
    expect(enc).not.toContain(keys.secretKey);
    const other = new BioRepo(createNodeDriver());
    await other.init();
    await other.restoreBackup(JSON.parse(await decryptText(JSON.parse(enc), "Diplodia-maydis-2026")));
    expect((await other.getKeys())?.secretKey).toBe(keys.secretKey);
  });
});

describe("registros sin datos sensibles", () => {
  it("oculta correos, tokens, llaves y nombres de usuario en rutas", () => {
    const t = redact(
      "GET https://api.unpaywall.org/v2/10.1/x?email=chris@iniap.gob.ec&api_key=abc123 falló; Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc; " +
        "llave 302e020100300506032b6570042204201f2a9c0e6b1d4f3a8e7c5b9d2f1a0e3c4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f; carpeta C:\\Users\\chris\\Sync y /home/chris/sync",
    );
    expect(t).not.toMatch(/chris@|abc123|eyJhbGci|1f2a9c0e|Users\\chris|home\/chris/);
    expect(t).toContain("email=[oculto]");
    expect(t).toContain("C:\\Users\\[usuario]\\Sync");
    // Lo que no es sensible se conserva (DOI, ORCID, nombres de fuentes)
    expect(redact("DOI 10.1094/php-06-23-0060-rs, ORCID 0000-0001-8380-5178, Crossref 400")).toBe("DOI 10.1094/php-06-23-0060-rs, ORCID 0000-0001-8380-5178, Crossref 400");
  });

  it("el registro de sincronización guarda el detalle ya limpio", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    await repo.addSyncLog({ peer: "C:\\Users\\chris\\Sync", direction: "in", count: 1, status: "error", detail: "fallo con token=xyz987 de chris@ejemplo.org" });
    const [e] = await repo.listSyncLog();
    expect(JSON.stringify(e)).not.toMatch(/chris|xyz987/);
  });
});

describe("inyección de HTML (XSS) en el editor y las exportaciones", () => {
  const evil: Work = {
    title: '<img src=x onerror="alert(1)"> Título <script>alert(2)</script>',
    authors: [{ name: '"><svg onload=alert(3)> Pérez' }],
    year: 2024,
    venue: "<iframe src=javascript:alert(4)>",
    doi: "10.1234/x\"><script>alert(5)</script>",
    source: "manual",
    fetchedAt: "2026-10-15T00:00:00Z",
  };
  it("títulos, autores y revistas maliciosos se muestran como texto", () => {
    const c = processCitations("Texto <b onclick=x>[@e]</b>", new Map([["e", evil]]), "apa-es");
    const html = blocksToHtml(parseMarkdown(c.text)) + referencesHtml(c.references, false, "Referencias</h2><script>");
    expect(html).not.toMatch(/<(img|script|svg|iframe|b)[\s>]/i);
    expect(html).toContain("&lt;script&gt;");
    expect(manuscriptHtml("</title><script>alert(6)</script>", html)).not.toMatch(/<script>/);
  });
  it("en Word (.docx) el texto no puede inyectar XML", () => {
    const xml = documentXml({ title: "x", blocks: parseMarkdown('</w:t></w:r><w:r><w:t>inyectado'), references: [{ segs: formatReference(evil, "vancouver") }] });
    expect(xml).not.toContain("</w:t></w:r><w:r><w:t>inyectado");
    expect(xml).toContain("&lt;/w:t&gt;");
    expect(xml).not.toContain("<script>");
  });
});

describe("inyección SQL y consultas de texto", () => {
  it("búsquedas con comillas, operadores FTS y SQL no rompen la base", async () => {
    const repo = new BioRepo(createNodeDriver());
    await repo.init();
    const { id } = await repo.upsertWork({ title: "Diplodia ear rot", authors: [], year: 2023, source: "manual", fetchedAt: "2026-10-15T00:00:00Z" });
    await repo.addToLibrary(id);
    for (const q of ["'; DROP TABLE works; --", '" OR 1=1 --', "NEAR(a b) AND NOT x*", "title:hack", "\u0000\u202e", "(((((", "*"]) {
      await expect(repo.listLibrary({ text: q })).resolves.toBeDefined();
    }
    expect(await repo.listLibrary({ text: "diplodia" })).toHaveLength(1);
    expect(toFtsQuery('a" OR b')).toBe('"a"* "OR"* "b"*');
  });
});

describe("archivos maliciosos o dañados (sin bloqueos)", () => {
  // Generador pseudoaleatorio con semilla: la prueba es reproducible
  let seed = 20261015;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const junk = (n: number) => Array.from({ length: n }, () => String.fromCharCode(Math.floor(rnd() * 0x2fff))).join("");
  const pieces = ["@article{", "TY  - JOUR\r\n", "%0 Journal Article\n", "ER  - \n", "}", "{", "\\", "=", ",", "\n", '"', "AU  - ", "[@", "**", "*", "_", "#", "\t", ";"];
  const mix = (n: number) => Array.from({ length: n }, () => (rnd() < 0.5 ? pieces[Math.floor(rnd() * pieces.length)] : junk(3))).join("");

  it("500 archivos aleatorios: los lectores de referencias, Markdown y tablas nunca fallan de forma inesperada", () => {
    for (let i = 0; i < 500; i++) {
      const text = mix(1 + Math.floor(rnd() * 200));
      for (const fn of [() => parseReferences(text, "x.ris"), () => parseReferences(text, "x.bib"), () => parseReferences(text, "x.enw"), () => parseMarkdown(text), () => parseTable(text)]) {
        try {
          fn();
        } catch (e) {
          // Solo se aceptan errores explicativos (Error simple), nunca TypeError/RangeError
          expect(e, `entrada ${JSON.stringify(text).slice(0, 120)}`).toBeInstanceOf(Error);
          expect((e as Error).constructor).toBe(Error);
        }
      }
    }
  });

  it("entradas patológicas grandes se procesan en tiempo razonable (sin ReDoS)", () => {
    const cases = ["*".repeat(100_000), "**a".repeat(30_000), "[@".repeat(50_000), "_".repeat(100_000) + "a", "@article{" + "{".repeat(50_000), "AU  - " + "a".repeat(200_000)];
    for (const c of cases) {
      const t0 = performance.now();
      try {
        parseInline(c);
        parseMarkdown(c);
        processCitations(c, new Map(), "apa-es");
        parseReferences(c, "x.bib");
        parseReferences(c, "x.ris");
      } catch {
        /* error explicativo aceptable */
      }
      expect(performance.now() - t0, `caso ${c.slice(0, 12)}…`).toBeLessThan(3000);
    }
  });
});

describe("identificadores ligados a una llave", () => {
  it("SHA-256 propio coincide con el de Node (vectores estándar y aleatorios)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    for (const n of [55, 56, 63, 64, 65, 1000, 100_000]) {
      const s = "ñ".repeat(n);
      expect(sha256Hex(s), `longitud ${n}`).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
  it("solo la llave correcta reconoce el identificador", () => {
    const k1 = "a".repeat(64);
    const k2 = "b".repeat(64);
    const id = boundUlid("biociencia-proyecto", k1, Date.UTC(2026, 9, 15));
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isBoundUlid(id, "biociencia-proyecto", k1)).toBe(true);
    expect(isBoundUlid(id, "biociencia-proyecto", k2)).toBe(false);
    expect(isBoundUlid(id.slice(0, 25) + (id[25] === "0" ? "1" : "0"), "biociencia-proyecto", k1)).toBe(false);
  });
});
