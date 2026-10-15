import { describe, expect, it } from "vitest";
import { CrossrefClient, DoajClient, EuropePmcClient, PubMedClient, searchSources, UnpaywallClient, type HttpGet } from "@biociencia/sources";

/**
 * Pruebas EN VIVO contra las fuentes gratuitas (requieren internet; se ejecutan en su PC con
 * `npm.cmd run test:live`). No cuestan nada. Si una fuente está caída, la prueba lo dice.
 * Opcional: defina BC_EMAIL con su correo para Crossref/PubMed/Unpaywall.
 */
const http: HttpGet = (url, init) => fetch(url, init);
const email = process.env.BC_EMAIL ?? null;
const q = { text: "Stenocarpella maydis", perPage: 5 };

describe("fuentes gratuitas en vivo", () => {
  it("Crossref", async () => {
    const r = await new CrossrefClient(http, { mailto: () => email }).search(q);
    expect(r.total).toBeGreaterThan(100);
    expect(r.works.length).toBeGreaterThan(0);
    expect(r.works.every((w) => w.title)).toBe(true);
  }, 30_000);

  it("PubMed", async () => {
    const r = await new PubMedClient(http, { email: () => email }).search(q);
    expect(r.total).toBeGreaterThan(10);
    expect(r.works[0]!.pmid).toMatch(/^\d+$/);
  }, 30_000);

  it("Europe PMC", async () => {
    const r = await new EuropePmcClient(http).search(q);
    expect(r.total).toBeGreaterThan(50);
    expect(r.works.some((w) => w.abstract)).toBe(true);
  }, 30_000);

  it("DOAJ", async () => {
    const r = await new DoajClient(http).search(q);
    expect(r.total).toBeGreaterThan(5);
    expect(r.works.every((w) => w.isOpenAccess)).toBe(true);
  }, 30_000);

  it("búsqueda combinada sin repetidos", async () => {
    const r = await searchSources([new EuropePmcClient(http), new PubMedClient(http, { email: () => email }), new CrossrefClient(http, { mailto: () => email }), new DoajClient(http)], q);
    const errors = r.outcomes.filter((o) => o.error);
    expect(errors, JSON.stringify(errors)).toHaveLength(0);
    const dois = r.works.map((w) => w.doi).filter(Boolean);
    expect(new Set(dois).size).toBe(dois.length);
  }, 60_000);

  it.skipIf(!email)("Unpaywall (necesita BC_EMAIL)", async () => {
    const info = await new UnpaywallClient(http, { email: () => email }).lookup("10.3389/fpls.2014.00715");
    expect(info.isOa).toBe(true);
    expect(info.best?.url).toMatch(/^https:\/\//);
  }, 30_000);
});
