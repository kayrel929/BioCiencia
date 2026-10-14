import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReferences, toBibTeX, toEndNote, toEndNoteXML, toRIS } from "@biociencia/core";
import { parseOpenAlexWork } from "../src/index.ts";

// Publicaciones reales de OpenAlex (ver openalex.test.ts): acentos, autores institucionales, tesis, conjuntos de datos
const at = "2026-10-14T16:00:00Z";
const search = JSON.parse(readFileSync(join(__dirname, "fixtures", "openalex-search-stenocarpella.json"), "utf8")).results;
const doi = JSON.parse(readFileSync(join(__dirname, "fixtures", "openalex-doi-ijms12095522.json"), "utf8"));
const works = [...search, doi].map((r: unknown) => parseOpenAlexWork(r, at));

describe("exportación de publicaciones reales y reimportación", () => {
  for (const [name, fn] of [["BibTeX", toBibTeX], ["RIS", toRIS], ["EndNote", toEndNote]] as const) {
    it(`${name}: mismos títulos, DOI, años y número de autores`, () => {
      const back = parseReferences(fn(works)).works;
      expect(back).toHaveLength(works.length);
      back.forEach((b, i) => {
        const o = works[i]!;
        expect(b.title).toBe(o.title.replace(/\s+/g, " "));
        expect(b.doi ?? null).toBe(o.doi ?? null);
        expect(b.year ?? null).toBe(o.year ?? null);
        expect(b.authors.length).toBe(o.authors.length);
        expect(b.abstract ?? null).toBe(o.abstract ? o.abstract.replace(/\s+/g, " ").trim() : null);
      });
    });
  }
  it("EndNote XML contiene un registro por publicación", () => {
    const x = toEndNoteXML(works);
    expect(x.match(/<record>/g)).toHaveLength(works.length);
    expect(x).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});
