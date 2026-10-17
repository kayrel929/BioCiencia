import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { authorSurname, emailsIn, formalAuthorRequest, lookupAuthorEmails, parseEuropePmcWork, type HttpGet } from "../src/index.ts";

/** Respuesta REAL de Europe PMC grabada el 2026-10-15 en el navegador del usuario (ver fixtures/FUENTES.md). */
const raw = readFileSync(join(__dirname, "fixtures", "europepmc-core-autores-correo-38117317.json"), "utf8");

function replay(body: string): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  }) as unknown as HttpGet & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("correo del autor (Europe PMC)", () => {
  it("extrae los correos de las afiliaciones, sin el punto final", () => {
    expect(emailsIn("Division of Nematology, New Delhi, 110012, India. tushar.dutta@icar.gov.in.")).toEqual(["tushar.dutta@icar.gov.in"]);
    expect(emailsIn("Sin correo.")).toEqual([]);
  });
  it("cada correo queda con su autor en la respuesta real", () => {
    const w = parseEuropePmcWork(JSON.parse(raw).resultList.result[0], "2026-10-15T00:00:00Z");
    expect(w.authors.map((a) => [a.name, a.email ?? null])).toEqual([
      ["Yogesh E Thorat", null],
      ["Tushar K Dutta", "tushar.dutta@icar.gov.in"],
      ["Pradeep K Jain", null],
      ["Kuppuswamy Subramaniam", null],
      ["Anil Sirohi", "anilsirohi@yahoo.com"],
    ]);
  });
  it("busca por DOI con resultType=core", async () => {
    const http = replay(raw);
    const r = await lookupAuthorEmails(http, { doi: "10.1007/s00299-023-03114-6", pmid: null });
    expect(http.calls[0]).toContain("query=DOI%3A%2210.1007%2Fs00299-023-03114-6%22");
    expect(http.calls[0]).toContain("resultType=core");
    expect(r).toEqual([
      { name: "Tushar K Dutta", email: "tushar.dutta@icar.gov.in", orcid: "0000-0002-0278-1707" },
      { name: "Anil Sirohi", email: "anilsirohi@yahoo.com", orcid: null },
    ]);
    expect(await lookupAuthorEmails(http, { doi: null, pmid: null })).toEqual([]);
  });
});

describe("solicitud formal del artículo completo", () => {
  const w = parseEuropePmcWork(JSON.parse(raw).resultList.result[0], "2026-10-15T00:00:00Z");
  const me = { name: "Christopher Suárez", title: "Dr.", position: "Investigador", institution: "INIAP, Ecuador", email: "investigador@example.org", orcid: "0000-0001-8380-5178" };
  const date = new Date("2026-10-15T12:00:00Z");

  it("apellido para el saludo en las formas habituales", () => {
    expect(authorSurname("Dutta TK")).toBe("Dutta");
    expect(authorSurname("Tushar K Dutta")).toBe("Dutta");
    expect(authorSurname("Huet, Gaëlle")).toBe("Huet");
    expect(authorSurname("B C Flett")).toBe("Flett");
    expect(authorSurname("")).toBe("");
  });

  it("en español: saludo formal, referencia APA, compromiso de uso y firma completa", () => {
    const { subject, body } = formalAuthorRequest(w, { name: "Tushar K Dutta" }, me, { lang: "es", date, purpose: "mi estudio sobre Meloidogyne en tomate." });
    expect(subject).toBe("Solicitud respetuosa de copia del artículo «A nematode-inducible promoter can effectively drives RNAi construct to confer Meloidogyne incognita resistance in tomato»");
    const lines = body.split("\n");
    expect(lines[0]).toBe("15 de octubre de 2026");
    expect(lines).toContain("Estimado(a) Dr(a). Dutta:");
    expect(lines).toContain("Reciba un cordial y respetuoso saludo.");
    expect(body).toContain("Mi nombre es Dr. Christopher Suárez, Investigador de INIAP, Ecuador. Me dirijo a usted con el mayor respeto");
    expect(body).toContain("https://doi.org/10.1007/s00299-023-03114-6");
    expect(body).toContain("Su trabajo resulta de especial relevancia para mi estudio sobre Meloidogyne en tomate. Lamentablemente");
    expect(body).toContain("exclusivamente con fines académicos y de investigación, a no redistribuirlo");
    expect(lines.slice(-5)).toEqual(["Dr. Christopher Suárez", "Investigador", "INIAP, Ecuador", "investigador@example.org", "ORCID: https://orcid.org/0000-0001-8380-5178"]);
    expect(lines).toContain("Con sentimientos de la más alta consideración y estima,");
  });

  it("en inglés y bilingüe; tratamiento según se elija", () => {
    const en = formalAuthorRequest(w, { name: "Anil Sirohi" }, me, { lang: "en", date });
    expect(en.subject).toMatch(/^Kind request for a copy of your article "A nematode-inducible/);
    expect(en.body).toContain("Dear Dr. Sirohi,");
    expect(en.body).toContain("October 15, 2026");
    expect(en.body).toContain("Your work is of particular relevance to my current research. Unfortunately");
    const both = formalAuthorRequest(w, { name: "Anil Sirohi" }, me, { lang: "es-en", date, salutation: "m", noAccess: false });
    expect(both.body).toContain("Estimado Dr. Sirohi:");
    expect(both.body).toContain("— English version —");
    expect(both.body).toContain("Dear Dr. Sirohi,");
    expect(both.body).not.toContain("Lamentablemente");
    expect(formalAuthorRequest(w, null, { name: "" }, { lang: "es", date, salutation: "f" }).body).toContain("Estimada Dra. Thorat:");
  });
});
