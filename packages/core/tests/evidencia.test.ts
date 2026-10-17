import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { citationsPerYear, evidenceLevel, highlyCited, matchSmartGroup, parseSmartRules, sentences, studySnapshot, worseRetraction, type Work } from "../src/index.ts";

/** Resúmenes REALES de Europe PMC (fixtures grabadas, ver packages/sources/tests/fixtures/FUENTES.md) */
const FX = join(__dirname, "..", "..", "sources", "tests", "fixtures");
const epmc = (f: string) => JSON.parse(readFileSync(join(FX, f), "utf8")).resultList.result as any[];
const toWork = (r: any): Work => ({
  title: String(r.title).replace(/\.$/, ""), authors: [], year: Number(r.pubYear), abstract: String(r.abstractText ?? "").replace(/<[^>]+>/g, " "),
  pubTypes: r.pubTypeList?.pubType ?? [], source: "europepmc", fetchedAt: "",
});
const flett = toWork(epmc("europepmc-keyword-null-30832079.json")[0]);
const thorat = toWork(epmc("europepmc-core-autores-correo-38117317.json")[0]);

describe("nivel de evidencia", () => {
  it("usa el tipo de publicación de PubMed cuando existe", () => {
    expect(evidenceLevel({ title: "x", pubTypes: ["Meta-Analysis", "Journal Article"] })).toEqual({ level: 1, label: "Metaanálisis", basis: "tipo de publicación (PubMed)" });
    expect(evidenceLevel({ title: "x", pubTypes: ["Randomized Controlled Trial", "Journal Article"] })!.level).toBe(3);
    expect(evidenceLevel({ title: "x", pubTypes: ["Systematic Review", "Review"] })!.level).toBe(2);
  });
  it("si no, lo detecta en el título o el resumen (resúmenes reales)", () => {
    expect(evidenceLevel(flett)).toMatchObject({ level: 4, basis: "título o resumen" }); // incidencia en rotaciones
    expect(evidenceLevel(thorat)).toMatchObject({ level: 3 }); // líneas transgénicas comparadas con el control
    expect(evidenceLevel({ title: "Efecto de Trichoderma: un metaanálisis", abstract: "" })!.level).toBe(1);
    expect(evidenceLevel({ title: "First report of Stenocarpella macrospora on maize in Ecuador", abstract: "" })!.level).toBe(5);
    expect(evidenceLevel({ title: "Sin pistas", abstract: "" })).toBeNull();
  });
});

describe("citas", () => {
  it("citas por año y «muy citado» relativo a los resultados", () => {
    const now = new Date("2026-06-01");
    expect(citationsPerYear({ citedByCount: 100, year: 2017 }, now)).toBe(10);
    expect(citationsPerYear({ citedByCount: null, year: 2017 }, now)).toBeNull();
    const works = [{ citedByCount: 200, year: 2020 }, { citedByCount: 5, year: 2020 }, { citedByCount: 8, year: 2024 }, { citedByCount: 2, year: 2025 }, { citedByCount: 40, year: 2010 }];
    expect([...highlyCited(works, now)]).toEqual([0]);
    expect(highlyCited(works.slice(0, 2), now).size).toBe(0); // muy pocos para comparar
  });
});

describe("ficha del estudio (sin IA, con su frase de origen)", () => {
  it("resumen real de Flett et al. (rotación de cultivos)", () => {
    const f = studySnapshot(flett);
    const get = (l: string) => f.find((i) => i.label === l);
    expect(get("Lugar")?.value).toBe("Sudáfrica");
    expect(get("Organismos")?.value).toContain("Stenocarpella maydis");
    expect(get("Hallazgo principal")?.value).toBe("Wheat, soybean, and peanut were the most effective, and sunflower the least effective, rotation crops for reducing S. maydis ear rot.");
    for (const it of f) expect(`${flett.title} ${flett.abstract}`).toContain(it.sentence); // cada frase existe tal cual (resumen o título)
  });
  it("resumen real de Thorat et al. (RNAi en tomate)", () => {
    const f = studySnapshot(thorat);
    expect(f.find((i) => i.label === "Organismos")?.value).toBe("Meloidogyne incognita, Arabidopsis thaliana, Solanum lycopersicum");
    expect(f.find((i) => i.label === "Duración o tiempo")?.value).toBe("10-21 days");
    expect(f.find((i) => i.label === "Hallazgo principal")?.value).toMatch(/^We conclude that pAt1g74770/);
  });
  it("muestra, diseño y ámbito en un texto de ensayo agrícola", () => {
    const f = studySnapshot({ title: "Ensayo", abstract: "Se evaluaron 24 parcelas en un diseño de bloques completos al azar en condiciones de campo en Orellana, Ecuador. Trichoderma harzianum redujo la incidencia en 45 %." });
    expect(f.map((i) => [i.label, i.value])).toEqual([
      ["Muestra", "24 parcelas"], ["Diseño", "Bloques completos al azar"], ["Ámbito", "Campo"], ["Lugar", "Ecuador"],
      ["Organismos", "Trichoderma harzianum"], ["Hallazgo principal", "Trichoderma harzianum redujo la incidencia en 45 %."],
    ]);
    expect(studySnapshot({ title: "x", abstract: null })).toEqual([]);
  });
  it("las frases no se cortan en abreviaturas", () => {
    expect(sentences("Se aisló S. maydis de 12 muestras. Fue patógeno (et al. 2020).")).toEqual(["Se aisló S. maydis de 12 muestras.", "Fue patógeno (et al. 2020)."]);
  });
});

describe("retracciones y grupos inteligentes", () => {
  it("se conserva el aviso más grave", () => {
    expect(worseRetraction({ status: "corrected", source: "crossref" }, { status: "retracted", source: "pubmed" })!.status).toBe("retracted");
    expect(worseRetraction(null, null)).toBeNull();
  });
  it("reglas por nivel de evidencia y por retractación", () => {
    const e = (w: Partial<Work>) => ({ work: { title: "t", authors: [], source: "manual" as const, fetchedAt: "", ...w }, tags: [], notes: "", favorite: false, own: false, pdfCount: 0, collectionIds: [], addedAt: "" });
    const g = parseSmartRules({ match: "all", rules: [{ field: "evidence", op: "lte", value: "2" }] });
    expect(matchSmartGroup(e({ pubTypes: ["Meta-Analysis"] }), g)).toBe(true);
    expect(matchSmartGroup(e({ pubTypes: ["Case Reports"] }), g)).toBe(false);
    const r = parseSmartRules({ match: "all", rules: [{ field: "retracted", op: "yes" }] });
    expect(matchSmartGroup(e({ retraction: { status: "retracted", source: "crossref" } }), r)).toBe(true);
    expect(matchSmartGroup(e({ retraction: { status: "corrected", source: "crossref" } }), r)).toBe(false);
  });
});
