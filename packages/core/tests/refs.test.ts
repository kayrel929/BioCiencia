import { describe, expect, it } from "vitest";
import {
  bibEscape, citationKeys, detectFormat, latexToText, parseBibTeX, parseEndNote, parseReferences, parseRIS, splitName,
  toBibTeX, toCSV, toCslJson, toEndNote, toEndNoteXML, toRIS, type Work,
} from "../src/index.ts";

const w1: Work = {
  title: "Isolation of Bacteria with Antifungal Activity against the Phytopathogenic Fungi Stenocarpella maydis and Stenocarpella macrospora",
  authors: [{ name: "Iván Petatán-Sagahón" }, { name: "Alejandro Téllez-Jurado" }, { name: "María de la Luz Hernández" }],
  year: 2011,
  venue: "International Journal of Molecular Sciences",
  doi: "10.3390/ijms12095522",
  pmid: "22016606",
  abstract: "Bacillus subtilis & Pseudomonas spp. showed 100% inhibition {in vitro}.",
  keywords: ["Stenocarpella", "biocontrol"],
  type: "article",
  language: "en",
  source: "openalex",
  fetchedAt: "2026-10-14T16:00:00Z",
};
const w2: Work = { title: "Stenocarpella macrospora en maíz", authors: [{ name: "Suárez, Christopher" }], year: 2025, venue: null, type: "dissertation", source: "manual", fetchedAt: "2026-10-14T16:00:00Z" };

describe("nombres y claves", () => {
  it("separa apellido y nombre en distintos formatos", () => {
    expect(splitName("Pérez, María José")).toEqual({ family: "Pérez", given: "María José" });
    expect(splitName("Iván Petatán-Sagahón")).toEqual({ family: "Petatán-Sagahón", given: "Iván" });
    expect(splitName("María de la Luz Hernández")).toEqual({ family: "Hernández", given: "María de la Luz" });
    expect(splitName("Ludwig van Beethoven")).toEqual({ family: "van Beethoven", given: "Ludwig" });
    expect(splitName("CABI")).toEqual({ family: "CABI", given: "" });
  });
  it("claves de cita únicas y sin acentos", () => {
    expect(citationKeys([w1, w1, w1])).toEqual(["petatansagahon2011isolation", "petatansagahon2011isolationa", "petatansagahon2011isolationb"]);
  });
  it("escapa LaTeX y lo revierte al importar", () => {
    expect(bibEscape("50% & {x} $1_2#")).toBe("50\\% \\& \\{x\\} \\$1\\_2\\#");
    expect(latexToText("Petat{\\'a}n \\& Mu\\~noz {Ralstonia} \\textit{in vitro}")).toBe("Petatán & Muñoz Ralstonia in vitro");
  });
});

describe("exportación", () => {
  it("BibTeX con tipo, campos existentes y sin inventar", () => {
    const b = toBibTeX([w1, w2]);
    expect(b).toContain("@article{petatansagahon2011isolation,");
    expect(b).toContain("author = {Petatán-Sagahón, Iván and Téllez-Jurado, Alejandro and Hernández, María de la Luz}");
    expect(b).toContain("doi = {10.3390/ijms12095522}");
    expect(b).toContain("abstract = {Bacillus subtilis \\& Pseudomonas spp. showed 100\\% inhibition \\{in vitro\\}.}");
    expect(b).toContain("@phdthesis{suarez2025stenocarpella,");
    expect(b.split("@phdthesis")[1]).not.toMatch(/doi|school/);
  });
  it("RIS con una línea por autor y cierre ER", () => {
    const r = toRIS([w1]);
    expect(r.split("\r\n").slice(0, 3)).toEqual(["TY  - JOUR", `TI  - ${w1.title}`, "AU  - Petatán-Sagahón, Iván"]);
    expect(r).toContain("DO  - 10.3390/ijms12095522");
    expect(r).toContain("AN  - PMID:22016606");
    expect(r.trimEnd().endsWith("ER  -")).toBe(true);
  });
  it("CSV abre en Excel con acentos y comas dentro de campos", () => {
    const c = toCSV([w1]);
    expect(c.startsWith("﻿titulo,autores,anio")).toBe(true);
    expect(c).toContain('"Iván Petatán-Sagahón; Alejandro Téllez-Jurado; María de la Luz Hernández"');
  });
  it("CSL-JSON válido para motores de citas", () => {
    const j = JSON.parse(toCslJson([w1, w2]));
    expect(j[0]).toMatchObject({ type: "article-journal", DOI: "10.3390/ijms12095522", issued: { "date-parts": [[2011]] }, "container-title": "International Journal of Molecular Sciences" });
    expect(j[0].author[0]).toEqual({ family: "Petatán-Sagahón", given: "Iván" });
    expect(j[1].type).toBe("thesis");
  });
  it("EndNote etiquetado (.enw)", () => {
    const e = toEndNote([w1]);
    expect(e.split("\r\n").slice(0, 3)).toEqual(["%0 Journal Article", `%T ${w1.title}`, "%A Petatán-Sagahón, Iván"]);
    expect(e).toContain("%J International Journal of Molecular Sciences");
    expect(e).toContain("%R 10.3390/ijms12095522");
    expect(e).toContain("%M 22016606");
  });
  it("EndNote XML bien formado y con caracteres escapados", () => {
    const x = toEndNoteXML([w1, w2]);
    expect(x).toContain('<ref-type name="Journal Article">17</ref-type>');
    expect(x).toContain('<ref-type name="Thesis">32</ref-type>');
    expect(x).toContain("<electronic-resource-num>10.3390/ijms12095522</electronic-resource-num>");
    expect(x).toContain("Bacillus subtilis &amp; Pseudomonas");
    expect(x.match(/<record>/g)).toHaveLength(2);
    expect(x.match(/<\/record>/g)).toHaveLength(2);
  });
});

describe("importación", () => {
  it("detecta el formato por extensión o contenido", () => {
    expect(detectFormat("", "mis-refs.bib")).toBe("bibtex");
    expect(detectFormat("TY  - JOUR\nER  - ")).toBe("ris");
    expect(detectFormat("%0 Journal Article\n%T X")).toBe("endnote");
    expect(detectFormat("@article{k, title={x}}")).toBe("bibtex");
    expect(detectFormat("hola")).toBeNull();
    expect(parseReferences("hola").warnings[0]).toMatch(/No se reconoce/);
  });

  it("BibTeX al estilo Zotero/JabRef: llaves anidadas, comillas, acentos LaTeX, @comment", () => {
    const bib = `% exportado
@comment{jabref-meta: x}
@string{ijms = "Int. J. Mol. Sci."}
@article{petatan2011,
  title = {Isolation of {Bacteria} with Antifungal Activity against {Stenocarpella} maydis},
  author = {Petat{\\'a}n-Sagah{\\'o}n, Iv{\\'a}n and T{\\'e}llez-Jurado, Alejandro},
  journal = "International Journal of Molecular Sciences",
  year = 2011,
  doi = {https://doi.org/10.3390/IJMS12095522},
  keywords = {Stenocarpella; biocontrol},
}
@book{sinTitulo, author = {Nadie}}
@phdthesis{s2025, title={Tesis}, author={Suárez, Christopher}, school={UCSG}, year={2025}}`;
    const r = parseBibTeX(bib);
    expect(r.works).toHaveLength(2);
    expect(r.works[0]).toMatchObject({
      title: "Isolation of Bacteria with Antifungal Activity against Stenocarpella maydis",
      year: 2011, doi: "10.3390/ijms12095522", venue: "International Journal of Molecular Sciences", type: "article", source: "import",
      keywords: ["Stenocarpella", "biocontrol"],
    });
    expect(r.works[0]!.authors.map((a) => a.name)).toEqual(["Petatán-Sagahón, Iván", "Téllez-Jurado, Alejandro"]);
    expect(r.works[1]).toMatchObject({ title: "Tesis", type: "dissertation", venue: "UCSG" });
    expect(r.warnings).toEqual(["Referencia 2: sin título, no se importó."]);
  });

  it("RIS al estilo Mendeley/EndNote con líneas de continuación y DOI en la URL", () => {
    const ris = ["TY  - JOUR", "T1  - Survival of Stenocarpella spp. in maize debris", "A1  - Pinto, F.", "AU  - Medeiros, F.", "Y1  - 2023/05/01", "JO  - Tropical Plant Pathology",
      "UR  - https://doi.org/10.1007/s40858-016-0079-3", "AB  - First line", "  continued here.", "KW  - maize", "KW  - Diplodia", "ER  - ", "",
      "TY  - BOOK", "PY  - 2020", "ER  - "].join("\r\n");
    const r = parseRIS(ris);
    expect(r.works).toHaveLength(1);
    expect(r.works[0]).toMatchObject({ year: 2023, venue: "Tropical Plant Pathology", doi: "10.1007/s40858-016-0079-3", abstract: "First line continued here.", keywords: ["maize", "Diplodia"] });
    expect(r.works[0]!.authors.map((a) => a.name)).toEqual(["Medeiros, F.", "Pinto, F."]);
    expect(r.warnings).toHaveLength(1);
  });

  it("EndNote .enw", () => {
    const enw = "%0 Journal Article\r\n%T Ralstonia solanacearum control\r\n%A Gómez, Ana\r\n%A Ruiz, Luis\r\n%J Plant Disease\r\n%D 2022\r\n%R 10.1094/PDIS-01-22-0001-RE\r\n%K wilt\r\nbiocontrol\r\n%X Resumen\r\n\r\n%0 Thesis\r\n%T Tesis de maestría\r\n%D 2019\r\n";
    const r = parseEndNote(enw);
    expect(r.works).toHaveLength(2);
    expect(r.works[0]).toMatchObject({ venue: "Plant Disease", year: 2022, doi: "10.1094/pdis-01-22-0001-re", keywords: ["wilt", "biocontrol"], abstract: "Resumen" });
    expect(r.works[1]).toMatchObject({ type: "dissertation", year: 2019 });
  });

  it("DOI inválido se avisa y se omite, no se inventa", () => {
    const r = parseRIS("TY  - JOUR\nTI  - X\nDO  - no-es-doi\nER  - \n");
    expect(r.works[0]!.doi).toBeNull();
    expect(r.warnings[0]).toMatch(/DOI no válido/);
  });
});

describe("ida y vuelta: exportar e importar conserva los datos", () => {
  for (const [name, exp] of [["BibTeX", toBibTeX], ["RIS", toRIS], ["EndNote", toEndNote]] as const) {
    it(name, () => {
      const back = parseReferences(exp([w1, w2])).works;
      expect(back).toHaveLength(2);
      expect(back[0]).toMatchObject({ title: w1.title, year: 2011, doi: w1.doi, venue: w1.venue, type: "article" });
      expect(back[0]!.authors).toHaveLength(3);
      expect(back[0]!.keywords).toEqual(["Stenocarpella", "biocontrol"]);
      expect(back[0]!.abstract).toBe(w1.abstract);
      expect(back[1]).toMatchObject({ title: w2.title, year: 2025, type: "dissertation" });
    });
  }
});
