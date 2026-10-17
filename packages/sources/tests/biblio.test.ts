import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatReference, segsToText } from "@biociencia/core";
import { parseCrossrefWork, parseDoajWork, parseEuropePmcWork, parseOpenAlexWork, parsePubmedXml } from "../src/index.ts";

/** Volumen, número y páginas tomados de respuestas REALES grabadas (fixtures/FUENTES.md). */
const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const vip = (w: { volume?: string | null; issue?: string | null; pages?: string | null }) => [w.volume ?? null, w.issue ?? null, w.pages ?? null];

describe("volumen, número y páginas desde cada fuente", () => {
  it("Crossref: volume, issue y page", () => {
    const items = JSON.parse(fx("crossref-search-stenocarpella.json")).message.items;
    expect(vip(parseCrossrefWork(items[0], ""))).toEqual(["33", "1", "76-87"]);
    // Sin esos campos en la respuesta, quedan vacíos (no se inventan)
    expect(vip(parseCrossrefWork(items[1], ""))).toEqual([null, null, null]);
  });
  it("DOAJ: journal.volume, journal.number y páginas inicial–final", () => {
    const r = JSON.parse(fx("doaj-search-stenocarpella.json")).results;
    expect(r.map((x: unknown) => vip(parseDoajWork(x, "")))).toEqual([["36", "1", "79-86"], ["2", "1", "13-24"]]);
  });
  it("Europe PMC y PubMed: número de artículo electrónico como página", () => {
    const r = JSON.parse(fx("europepmc-search-stenocarpella.json")).resultList.result;
    expect(vip(parseEuropePmcWork(r[0], ""))).toEqual(["2025", null, "4160516"]);
    expect(vip(parsePubmedXml(fx("pubmed-efetch-41141834.xml"), "")[0]!)).toEqual(["2025", null, "4160516"]);
  });
  it("OpenAlex: biblio first_page–last_page y referencia APA completa", () => {
    const biblio = JSON.parse(fx("openalex-biblio-ijms12095522.json"));
    const full = JSON.parse(fx("openalex-doi-ijms12095522.json"));
    const w = parseOpenAlexWork({ ...full, biblio: biblio.biblio }, "");
    expect(vip(w)).toEqual(["12", "9", "5522-5537"]);
    expect(segsToText(formatReference(w, "apa-es"))).toContain(", 12(9), 5522–5537. https://doi.org/10.3390/ijms12095522");
  });
});
