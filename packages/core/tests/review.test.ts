import { describe, expect, it } from "vitest";
import { buildStrategy, conceptTerms, methodsText, prismaCounts, type ReviewQuestion } from "../src/index.ts";

const q: ReviewQuestion = {
  question: "¿Qué fuentes de resistencia a la pudrición de mazorca por Stenocarpella existen en maíz?",
  framework: "peo",
  concepts: [
    { name: "Cultivo", terms: ["maize", "corn", "Zea mays", " Maize ", ""] },
    { name: "Patógeno", terms: ["Stenocarpella", "Diplodia"] },
    { name: "Resultado", terms: ["resist*"] },
    { name: "Vacío", terms: ["  "] },
  ],
};

describe("estrategia de búsqueda", () => {
  it("quita vacíos y repetidos", () => {
    expect(conceptTerms(q.concepts[0]!)).toEqual(["maize", "corn", "Zea mays"]);
  });
  it("PubMed con [tiab] y truncamiento (sintaxis verificada en la API real)", () => {
    expect(buildStrategy(q, "pubmed")).toBe('("maize"[tiab] OR "corn"[tiab] OR "Zea mays"[tiab]) AND ("Stenocarpella"[tiab] OR "Diplodia"[tiab]) AND resist*[tiab]');
  });
  it("Europe PMC con TITLE_ABS", () => {
    expect(buildStrategy(q, "europepmc")).toBe('(TITLE_ABS:"maize" OR TITLE_ABS:"corn" OR TITLE_ABS:"Zea mays") AND (TITLE_ABS:"Stenocarpella" OR TITLE_ABS:"Diplodia") AND TITLE_ABS:resist*');
  });
  it("simplificada para fuentes sin lógica booleana; comillas del usuario no rompen la consulta", () => {
    expect(buildStrategy(q, "simple")).toBe("maize Stenocarpella resist*");
    expect(buildStrategy({ ...q, concepts: [{ name: "x", terms: ['"ear rot"'] }] }, "pubmed")).toBe('"ear rot"[tiab]');
    expect(buildStrategy({ ...q, concepts: [] }, "pubmed")).toBe("");
  });
});

describe("conteos PRISMA 2020", () => {
  it("identificados, duplicados, cribados, excluidos por motivo e incluidos", () => {
    const runs = [
      { source: "pubmed", label: "PubMed", found: 8, retrieved: 8, query: "q1" },
      { source: "europepmc", label: "Europe PMC", found: 22, retrieved: 22, query: "q2" },
      { source: "crossref", label: "Crossref", found: 0, retrieved: 0, query: "q3", skipped: "no permite" },
      { source: "doaj", label: "DOAJ", found: 0, retrieved: 0, query: "q4", error: "tiempo agotado" },
    ];
    const recs = [
      ...Array.from({ length: 5 }, () => ({ decision: "include" as const })),
      ...Array.from({ length: 12 }, () => ({ decision: "exclude" as const, reason: "No trata el tema" })),
      ...Array.from({ length: 3 }, () => ({ decision: "exclude" as const, reason: "Otro tipo de estudio" })),
      ...Array.from({ length: 4 }, () => ({ decision: "pending" as const })),
    ];
    const c = prismaCounts(runs, recs);
    expect(c).toMatchObject({ retrieved: 30, duplicates: 6, screened: 24, excluded: 15, pending: 4, included: 5 });
    expect(c.identified.map((x) => x.source)).toEqual(["pubmed", "europepmc"]);
    expect(c.excludedByReason).toEqual([{ reason: "No trata el tema", n: 12 }, { reason: "Otro tipo de estudio", n: 3 }]);
  });
  it("texto de métodos con estrategia exacta, errores y fuentes omitidas", () => {
    const t = methodsText(q, [
      { source: "pubmed", label: "PubMed", found: 1234, retrieved: 100, query: "Q" },
      { source: "doaj", label: "DOAJ", found: 0, retrieved: 0, query: "R", error: "tiempo agotado" },
    ], "2026-10-15", { yearFrom: 2000, extra: ["Metaanálisis"] });
    expect(t).toContain("Años: 2000–….");
    expect(t).toContain("- PubMed: Q (1234 resultados; 100 recuperados para cribado)");
    expect(t).toContain("- DOAJ: R (error: tiempo agotado)");
  });
});
