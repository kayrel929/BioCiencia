import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeOrcid } from "@biociencia/core";
import { collapseSameWork, currentEmployment, OrcidClient, parseOrcidEmployments, parseOrcidExternalIds, parseOrcidWorks, SourceError, type HttpGet } from "../src/index.ts";

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

  it("une la misma publicación registrada con DOI distintos (mismo título y año)", () => {
    // Caso real observado en un registro ORCID: un artículo de Bionatura con tres prefijos DOI
    const base = { authors: [{ name: "C" }], year: 2024, source: "orcid" as const, fetchedAt: "x" };
    const t = "In vitro evaluation of the inhibitory capacity of three Trichoderma isolates on Ralstonia";
    const r = collapseSameWork([
      { ...base, title: t, doi: "10.21931/rb/2024.09.01.6" },
      { ...base, title: t.toUpperCase(), doi: "10.21931/bj/2024.01.01.6" },
      { ...base, title: t, doi: "10.70099/bj/2024.01.01.14" },
      { ...base, title: "Otro artículo", doi: "10.1234/otro" },
      { ...base, title: t, year: 2025, doi: "10.1234/version-2025" },
    ]);
    expect(r.works.map((w) => w.doi)).toEqual(["10.21931/rb/2024.09.01.6", "10.1234/otro", "10.1234/version-2025"]);
    expect(r.collapsed).toHaveLength(1);
    expect(r.collapsed[0]!.dropped.map((d) => d.doi)).toEqual(["10.21931/bj/2024.01.01.6", "10.70099/bj/2024.01.01.14"]);
  });

  it("lee el empleo público actual (institución y cargo) para la firma de las solicitudes", async () => {
    const body = JSON.stringify({
      "affiliation-group": [
        { summaries: [{ "employment-summary": { "role-title": "Pasante", "department-name": "Fitopatología", organization: { name: "Instituto X" }, "start-date": { year: { value: "2012" } }, "end-date": { year: { value: "2016" } } } }] },
        { summaries: [{ "employment-summary": { "role-title": "Investigador Agropecuario", "department-name": "Protección Vegetal", organization: { name: "INIAP" }, "start-date": { year: { value: "2017" } }, "end-date": null } }] },
      ],
    });
    const { http, calls } = replay({ "/employments": { body } });
    const list = await new OrcidClient(http, { now: NOW }).employments("0000-0002-1825-0097");
    expect(list).toHaveLength(2);
    expect(currentEmployment(list)).toEqual({
      organization: "INIAP",
      department: "Protección Vegetal",
      role: "Investigador Agropecuario",
      startYear: 2017,
      current: true,
    });
    expect(calls).toEqual(["https://pub.orcid.org/v3.0/0000-0002-1825-0097/employments"]);
  });

  it("si ningún empleo sigue abierto, se usa el más reciente; y sin empleos, nada", () => {
    const list = parseOrcidEmployments({
      "affiliation-group": [
        { summaries: [{ "employment-summary": { organization: { name: "A" }, "role-title": "Uno", "start-date": { year: { value: "2010" } }, "end-date": { year: { value: "2011" } } } }] },
        { summaries: [{ "employment-summary": { organization: { name: "B" }, "role-title": "Dos", "start-date": { year: { value: "2020" } }, "end-date": { year: { value: "2021" } } } }] },
      ],
    });
    expect(currentEmployment(list)?.organization).toBe("B");
    expect(currentEmployment([])).toBeNull();
    expect(currentEmployment(parseOrcidEmployments({}))).toBeNull();
  });

  it("lee el «Scopus Author ID» que la persona enlazó en su ORCID", async () => {
    const body = JSON.stringify({
      "external-identifiers": [
        { "external-identifier-type": "Scopus Author ID", "external-identifier-id": { value: "57190000000" } },
        { "external-identifier-type": "ResearcherID", "external-identifier-id": { value: "A-1234-5678" } },
      ],
    });
    const { http, calls } = replay({ "/external-identifiers": { body } });
    const ext = await new OrcidClient(http, { now: NOW }).externalIdentifiers("0000-0002-1825-0097");
    expect(ext).toEqual({ scopusAuthorId: "57190000000" });
    expect(calls).toEqual(["https://pub.orcid.org/v3.0/0000-0002-1825-0097/external-identifiers"]);
  });

  it("sin identificadores externos públicos, no inventa ninguno", () => {
    expect(parseOrcidExternalIds({})).toEqual({ scopusAuthorId: null });
    // ORCID a veces entrega el valor como texto y la lista con otro nombre
    expect(parseOrcidExternalIds({ "external-identifier": [{ "external-identifier-type": "Scopus Author ID", "external-identifier-id": "12345" }] })).toEqual({ scopusAuthorId: "12345" });
  });
});
