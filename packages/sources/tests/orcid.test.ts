import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeOrcid } from "@biociencia/core";
import { OrcidClient, parseOrcidWorks, SourceError, type HttpGet } from "../src/index.ts";

/**
 * Respuestas reales de pub.orcid.org grabadas el 2026-10-15. 0000-0002-1825-0097 es
 * «Josiah Carberry», la cuenta de DEMOSTRACIÓN oficial de ORCID (no es una persona real).
 */
const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const NOW = () => new Date("2026-10-15T13:00:00Z");

function replay(map: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const http = vi.fn(async (url: string) => {
    calls.push(url);
    const k = Object.keys(map).find((x) => url.includes(x));
    if (!k) throw new Error(`sin respuesta grabada: ${url}`);
    const { status = 200, body } = map[k]!;
    return { ok: status < 300, status, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet;
  return { http, calls };
}

describe("ORCID", () => {
  it("valida el dígito de control y normaliza", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000000218250097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000-0002-1694-233X")).toBe("0000-0002-1694-233X");
    expect(normalizeOrcid("0000-0002-1825-0098")).toBeNull(); // dígito de control incorrecto
    expect(normalizeOrcid("1234")).toBeNull();
  });

  it("lee el nombre público y los trabajos del registro (uno por grupo, sin duplicar)", async () => {
    const { http, calls } = replay({ "/personal-details": { body: fx("orcid-personal-carberry.json") }, "/works": { body: fx("orcid-works-carberry.json") } });
    const c = new OrcidClient(http, { now: NOW });
    const p = await c.person("0000-0002-1825-0097");
    expect(p).toEqual({ orcid: "0000-0002-1825-0097", name: "Josiah Carberry", otherNames: ["Josiah Stinkney Carberry", "J. Carberry", "J. S. Carberry"] });
    const works = await c.works("https://orcid.org/0000-0002-1825-0097", p.name);
    // 6 grupos en el registro; el primero tiene 2 versiones del mismo trabajo (se usa una)
    expect(works).toHaveLength(6);
    expect(works.filter((w) => w.doi === "10.5555/12345680")).toHaveLength(1);
    expect(works.map((w) => w.doi)).toContain("10.1109/tps.1987.4316723");
    const plasma = works.find((w) => w.doi === "10.1109/tps.1987.4316723")!;
    expect(plasma).toMatchObject({ title: "Bulk and surface plasmons in artificially structured materials", year: 1987, venue: "IEEE Transactions on Plasma Science", type: "article", source: "orcid", putCode: "19980729" });
    expect(plasma.authors).toEqual([{ name: "Josiah Carberry", orcid: "0000-0002-1825-0097" }]);
    // El ISSN de la revista («part-of») no se confunde con un identificador del trabajo
    expect(works.every((w) => w.doi?.startsWith("10."))).toBe(true);
    expect(calls).toEqual(["https://pub.orcid.org/v3.0/0000-0002-1825-0097/personal-details", "https://pub.orcid.org/v3.0/0000-0002-1825-0097/works"]);
  });

  it("ORCID inválido o inexistente (404 real)", async () => {
    const { http } = replay({ "/personal-details": { status: 404, body: '{"response-code":404,"developer-message":"404 Not Found: The resource was not found.","user-message":"The resource was not found.","error-code":9016,"more-info":"https://members.orcid.org/api/resources/troubleshooting"}' } });
    const c = new OrcidClient(http);
    await expect(c.person("0000-0002-1825-0098")).rejects.toThrow(/no es válido/);
    const e = await c.person("0000-0002-1694-233X").catch((x) => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.message).toMatch(/No existe un registro ORCID público/);
  });

  it("completa coautores, resumen y citas con Crossref sin pisar lo registrado en ORCID", async () => {
    const own = [
      { putCode: "1", title: "Breeding for resistances to Ralstonia solanacearum", authors: [{ name: "Yo" }], year: 2014, venue: null, doi: "10.3389/fpls.2014.00715", source: "orcid" as const, fetchedAt: "x" },
      { putCode: "2", title: "Prevalence…", authors: [{ name: "Yo" }], year: 2023, venue: "Mi revista", doi: "10.1094/php-06-23-0060-rs", source: "orcid" as const, fetchedAt: "x" },
      { putCode: "3", title: "Tesis sin DOI", authors: [{ name: "Yo" }], year: 2010, doi: null, source: "orcid" as const, fetchedAt: "x" },
    ];
    const { http, calls } = replay({ "api.crossref.org/works": { body: fx("crossref-dois-2.json") } });
    const r = await new OrcidClient(http, { now: NOW, mailto: () => "investigador@example.org" }).enrichWithCrossref(own);
    expect(r.enriched).toBe(2);
    expect(r.error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0]!)).toContain("filter=doi:10.3389/fpls.2014.00715,doi:10.1094/php-06-23-0060-rs");
    const [a, b, c] = r.works;
    expect(a).toMatchObject({ venue: "Frontiers in Plant Science", citedByCount: 155, year: 2014 });
    expect(b!.authors.map((x) => x.name)).toEqual(["Nolan R. Anderson", "Kiersten A. Wise"]);
    expect(b!.venue).toBe("Mi revista"); // lo de ORCID manda
    expect(b!.year).toBe(2023);
    expect(b!.abstract).toMatch(/^Kentucky corn \( Zea mays L\.\) fields were surveyed/);
    expect(c).toEqual(own[2]);
  });

  it("si Crossref falla, se conservan los datos de ORCID y se informa", async () => {
    const { http } = replay({ "api.crossref.org": { status: 503, body: "x" } });
    const own = parseOrcidWorks(JSON.parse(fx("orcid-works-carberry.json")), "Josiah Carberry", "0000-0002-1825-0097", "x");
    const r = await new OrcidClient(http).enrichWithCrossref(own);
    expect(r.enriched).toBe(0);
    expect(r.error).toBe("Crossref respondió con un error (503).");
    expect(r.works).toEqual(own);
  });
});
