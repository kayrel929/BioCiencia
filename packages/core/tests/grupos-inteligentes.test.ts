import { describe, expect, it } from "vitest";
import { describeSmartRules, matchSmartGroup, parseSmartRules, type SmartEntry } from "../src/index.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const base = (over: Partial<SmartEntry> & { title: string; year?: number }): SmartEntry => ({
  work: { title: over.title, authors: [{ name: "Gaëlle Huet" }], year: over.year ?? 2020, venue: "Plant Disease", source: "crossref", fetchedAt: "", doi: "10.1/x", isOpenAccess: false, keywords: ["biocontrol"], abstract: "Efecto de Trichoderma harzianum sobre Ralstonia." },
  tags: [], notes: "", favorite: false, own: false, pdfCount: 0, collectionIds: [], addedAt: "2026-10-10T00:00:00Z",
  ...over,
});

describe("grupos inteligentes", () => {
  const a = base({ title: "Trichoderma contra Ralstonia en tomate", year: 2022, tags: ["Tesis"], pdfCount: 1 });
  const b = base({ title: "Stenocarpella en maíz", year: 2015, favorite: true, collectionIds: ["c1"], addedAt: "2025-01-01T00:00:00Z" });

  it("todas las reglas (Y)", () => {
    const g = parseSmartRules({ match: "all", rules: [{ field: "year", op: "gte", value: "2020" }, { field: "any", op: "contains", value: "trichoderma" }] });
    expect([a, b].filter((e) => matchSmartGroup(e, g, NOW)).map((e) => e.work.title)).toEqual(["Trichoderma contra Ralstonia en tomate"]);
  });
  it("cualquier regla (O), sin tildes ni mayúsculas, frase exacta", () => {
    const g = parseSmartRules({ match: "any", rules: [{ field: "title", op: "contains", value: "MAIZ" }, { field: "tag", op: "is", value: "tesis" }] });
    expect([a, b].filter((e) => matchSmartGroup(e, g, NOW))).toHaveLength(2);
    const phrase = parseSmartRules({ match: "all", rules: [{ field: "abstract", op: "contains", value: '"harzianum sobre"' }] });
    expect(matchSmartGroup(a, phrase, NOW)).toBe(true);
    const words = parseSmartRules({ match: "all", rules: [{ field: "abstract", op: "contains", value: "ralstonia efecto" }] });
    expect(matchSmartGroup(a, words, NOW)).toBe(true);
  });
  it("sí/no, colección y añadidas en los últimos días", () => {
    const g = (r: object) => parseSmartRules({ match: "all", rules: [r] });
    expect(matchSmartGroup(a, g({ field: "pdf", op: "yes" }), NOW)).toBe(true);
    expect(matchSmartGroup(b, g({ field: "pdf", op: "yes" }), NOW)).toBe(false);
    expect(matchSmartGroup(b, g({ field: "favorite", op: "yes" }), NOW)).toBe(true);
    expect(matchSmartGroup(b, g({ field: "collection", op: "is", value: "c1" }), NOW)).toBe(true);
    expect(matchSmartGroup(a, g({ field: "collection", op: "is_not", value: "c1" }), NOW)).toBe(true);
    expect(matchSmartGroup(a, g({ field: "added", op: "within_days", value: "30" }), NOW)).toBe(true);
    expect(matchSmartGroup(b, g({ field: "added", op: "within_days", value: "30" }), NOW)).toBe(false);
    expect(matchSmartGroup(a, g({ field: "title", op: "not_contains", value: "maíz" }), NOW)).toBe(true);
  });
  it("reglas inválidas o incompletas se descartan; un grupo sin reglas no muestra nada", () => {
    const g = parseSmartRules({ match: "x", rules: [{ field: "hack", op: "is", value: "1" }, { field: "year", op: "contains", value: "1" }, { field: "title", op: "contains", value: "" }] });
    expect(g.match).toBe("all");
    expect(g.rules).toHaveLength(1); // solo la de título (vacía) tiene campo y operador válidos
    expect(matchSmartGroup(a, g, NOW)).toBe(false);
    expect(parseSmartRules(null)).toEqual({ match: "all", rules: [] });
  });
  it("descripción legible", () => {
    const g = parseSmartRules({ match: "all", rules: [{ field: "year", op: "gte", value: "2020" }, { field: "pdf", op: "yes" }, { field: "added", op: "within_days", value: "30" }] });
    expect(describeSmartRules(g)).toBe("Año desde (≥) «2020» y Tiene PDF: sí y Añadida a la biblioteca en los últimos 30 días");
  });
});
