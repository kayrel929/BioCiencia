import { describe, expect, it } from "vitest";
import {
  apaInText, blocksToHtml, crc32, documentXml, formatReference, initials, manuscriptDocx, parseInline, parseMarkdown,
  processCitations, referencesHtml, segsToText, wordCount, zipStore, type Work,
} from "../src/index.ts";

// Publicaciones de prueba (datos de ejemplo para las pruebas unitarias, no resultados de búsqueda)
const at = "2026-10-15T00:00:00Z";
const art: Work = {
  title: "Efecto del riego en el rendimiento del maíz",
  authors: [{ name: "Ana María Torres" }, { name: "Luis Pérez" }],
  year: 2021,
  venue: "Revista de Ejemplo Agrícola",
  volume: "12",
  issue: "3",
  pages: "45-60",
  doi: "10.1234/ejemplo.2021.1",
  source: "manual",
  fetchedAt: at,
};
const solo: Work = { title: "Un estudio sin revista", authors: [{ name: "Jean-Paul Martin" }], year: null, source: "manual", fetchedAt: at };
const many = (n: number): Work => ({
  title: "Estudio multicéntrico",
  authors: Array.from({ length: n }, (_, i) => ({ name: `Nombre${i + 1} Apellido${i + 1}` })),
  year: 2020,
  venue: "Revista X",
  source: "manual",
  fetchedAt: at,
});

describe("iniciales", () => {
  it("con y sin puntos, nombres compuestos", () => {
    expect(initials("Ana María")).toBe("A. M.");
    expect(initials("Jean-Paul")).toBe("J.-P.");
    expect(initials("Nolan R.", false)).toBe("NR");
  });
});

describe("APA 7", () => {
  it("referencia de artículo en español con volumen, número, páginas y DOI", () => {
    const segs = formatReference(art, "apa-es");
    expect(segsToText(segs)).toBe("Torres, A. M., y Pérez, L. (2021). Efecto del riego en el rendimiento del maíz. Revista de Ejemplo Agrícola, 12(3), 45–60. https://doi.org/10.1234/ejemplo.2021.1");
    // revista y volumen en cursiva, el número no
    expect(segs.filter((s) => s.italic).map((s) => s.text)).toEqual(["Revista de Ejemplo Agrícola", "12"]);
  });
  it("en inglés usa & y n.d.", () => {
    expect(segsToText(formatReference(art, "apa-en"))).toContain("Torres, A. M., & Pérez, L. (2021).");
    expect(segsToText(formatReference(solo, "apa-en"))).toBe("Martin, J.-P. (n.d.). Un estudio sin revista.");
    expect(segsToText(formatReference(solo, "apa-es"))).toBe("Martin, J.-P. (s. f.). Un estudio sin revista.");
  });
  it("21 autores o más: 19 primeros, puntos suspensivos y el último", () => {
    const t = segsToText(formatReference(many(25), "apa-es"));
    expect(t).toContain("Apellido19, N., . . . Apellido25, N. (2020)");
    expect(t).not.toContain("Apellido20");
    const t20 = segsToText(formatReference(many(20), "apa-es"));
    expect(t20).toContain("Apellido19, N., y Apellido20, N. (2020)");
  });
  it("citas en el texto: 1, 2 y 3+ autores", () => {
    expect(apaInText(solo, "es")).toBe("Martin, s. f.");
    expect(apaInText(art, "es")).toBe("Torres y Pérez, 2021");
    expect(apaInText(art, "en")).toBe("Torres & Pérez, 2021");
    expect(apaInText(many(3), "es")).toBe("Apellido1 et al., 2020");
  });
});

describe("Vancouver", () => {
  it("formato de revista", () => {
    expect(segsToText(formatReference(art, "vancouver"))).toBe("Torres AM, Pérez L. Efecto del riego en el rendimiento del maíz. Revista de Ejemplo Agrícola. 2021;12(3):45-60. doi:10.1234/ejemplo.2021.1");
  });
  it("más de 6 autores: 6 y et al", () => {
    const t = segsToText(formatReference(many(8), "vancouver"));
    expect(t.startsWith("Apellido1 N, Apellido2 N, Apellido3 N, Apellido4 N, Apellido5 N, Apellido6 N, et al. ")).toBe(true);
  });
});

describe("procesar citas del manuscrito", () => {
  const b: Work = { ...art, title: "Segundo trabajo de los mismos autores", doi: "10.1234/ejemplo.2021.2" };
  const lib = new Map<string, Work>([
    ["torres2021a", art],
    ["torres2021b", b],
    ["martin", solo],
    ["multi", many(3)],
  ]);

  it("Vancouver numera por orden de aparición y comprime rangos", () => {
    const r = processCitations("Uno [@multi]. Dos [@martin; @torres2021a; @multi]. Tres [@torres2021b]. Todo [@torres2021b; @martin; @torres2021a; @multi]", lib, "vancouver");
    expect(r.text).toBe("Uno [1]. Dos [1-3]. Tres [4]. Todo [1-4]");
    expect(r.references.map((x) => x.key)).toEqual(["multi", "martin", "torres2021a", "torres2021b"]);
    expect(r.missing).toEqual([]);
  });

  it("APA ordena alfabéticamente y desambigua el mismo autor-año con a/b", () => {
    const r = processCitations("Ver [@torres2021b; @martin] y [@torres2021a].", lib, "apa-es");
    // «Efecto…» va antes que «Segundo…» → 2021a
    expect(r.text).toBe("Ver (Martin, s. f.; Torres y Pérez, 2021b) y (Torres y Pérez, 2021a).");
    expect(r.references.map((x) => x.key)).toEqual(["martin", "torres2021a", "torres2021b"]);
    expect(segsToText(r.references[1]!.segs)).toContain("(2021a)");
  });

  it("informa las claves que no están en la biblioteca y las deja sin cambiar", () => {
    const r = processCitations("Algo [@noexiste] y [@martin; @tampoco].", lib, "apa-es");
    expect(r.missing).toEqual(["noexiste", "tampoco"]);
    expect(r.text).toBe("Algo [@noexiste] y (Martin, s. f.).");
  });
});

describe("manuscrito en Markdown", () => {
  it("bloques, listas y formato en línea", () => {
    const blocks = parseMarkdown("# Título\n\nUn **párrafo** con *cursiva*\ny otra línea.\n\n- uno\n- dos\n\n1. a\n2. b\n\n## Métodos");
    expect(blocks.map((b) => b.type)).toEqual(["h1", "p", "ul", "ol", "h2"]);
    expect(parseInline("a **b** _c_")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true }]);
    expect(blocksToHtml(blocks)).toContain("<p>Un <strong>párrafo</strong> con <em>cursiva</em> y otra línea.</p>");
    expect(blocksToHtml(parseMarkdown("x <script>"))).toBe("<p>x &lt;script&gt;</p>");
  });
  it("cuenta palabras con acentos y números", () => {
    expect(wordCount("El maíz creció 12 cm en épocas secas.")).toBe(8);
  });
  it("lista de referencias en HTML", () => {
    const html = referencesHtml([{ segs: formatReference(art, "apa-es") }], false, "Referencias");
    expect(html).toContain("<em>Revista de Ejemplo Agrícola</em>");
    expect(html).toContain('class="refs apa"');
  });
});

describe("Word (.docx) sin librerías", () => {
  it("CRC-32 conocido", () => {
    // valor estándar de CRC-32 para "123456789"
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("ZIP con firmas y directorio central", () => {
    const z = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hola") }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
  });
  it("documento con estilos, cursivas y referencias", () => {
    const xml = documentXml({ title: "T", blocks: parseMarkdown("# T\n\nTexto & más"), references: [{ segs: formatReference(art, "apa-es") }] });
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain("Texto &amp; más");
    expect(xml).toContain('<w:pStyle w:val="Bibliography"/>');
    expect(xml).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Revista de Ejemplo Agrícola</w:t>');
    const bytes = manuscriptDocx({ title: "T", blocks: parseMarkdown("# T") });
    expect(new TextDecoder().decode(bytes)).toContain("[Content_Types].xml");
  });
});
