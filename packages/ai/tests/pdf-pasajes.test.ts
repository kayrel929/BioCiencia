import { describe, expect, it } from "vitest";
import { quoteFound, relevantPassages, sourceTextFor } from "../src/index.ts";

// Texto de ejemplo con estructura de artículo (no es un artículo real: solo prueba la selección de pasajes)
const intro = "Introduction. Maize is a staple crop in tropical regions and ear rots reduce yield and grain quality. ".repeat(6);
const methods = "Materials and methods. Isolates were obtained from symptomatic ears collected in Orellana province. ".repeat(6);
const results = "Results. Stenocarpella macrospora caused ear rot in all inoculated hybrids, with incidence between 12 and 38 percent. ".repeat(3);
const discussion = "Discussion. Crop residues are the main source of inoculum, so rotation may reduce disease pressure. ".repeat(6);
const pdf = [intro, methods].join("\n\n") + "\f" + [results, discussion].join("\n\n");

describe("pasajes del PDF para la IA", () => {
  it("elige los pasajes con los términos y respeta el tamaño", () => {
    const p = relevantPassages(pdf, ["Stenocarpella", "incidence"], 700);
    expect(p).toContain("Stenocarpella macrospora caused ear rot");
    expect(p).not.toContain("Isolates were obtained");
    expect(p.length).toBeLessThanOrEqual(800);
  });
  it("los pasajes son copias literales: una frase del PDF se verifica", () => {
    const p = relevantPassages(pdf, ["Stenocarpella"], 700);
    expect(quoteFound("caused ear rot in all inoculated hybrids", p)).toBe(true);
    expect(quoteFound("caused ear rot in no hybrids at all", p)).toBe(false);
  });
  it("texto corto se entrega completo; resumen y PDF juntos", () => {
    expect(relevantPassages("Corto.\fDos.", ["x"])).toBe("Corto.\nDos.");
    expect(sourceTextFor("Resumen breve.", null, [])).toBe("Resumen breve.");
    expect(sourceTextFor(null, null, [])).toBe("");
    expect(sourceTextFor("Resumen breve.", pdf, ["rotation"])).toMatch(/^RESUMEN: Resumen breve\.\n\nTEXTO COMPLETO \(pasajes\): .*rotation may reduce/s);
  });
});
