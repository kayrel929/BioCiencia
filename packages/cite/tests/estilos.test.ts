import { describe, expect, it } from "vitest";
import type { Work } from "@biociencia/core";
import {
  formatBibliography, htmlToRich, htmlToSegs, isIncluded, loadCatalog, nearestLocale, parseStyleXml, resolveStyle, searchStyles, styleUrl, type StyleStore,
} from "../src/index.ts";

const huet: Work = {
  title: "Breeding for resistances to Ralstonia solanacearum",
  authors: [{ name: "Gaëlle Huet" }],
  year: 2014,
  venue: "Frontiers in Plant Science",
  volume: "5",
  pages: "715",
  doi: "10.3389/fpls.2014.00715",
  source: "crossref",
  fetchedAt: "2026-10-15T00:00:00Z",
};
const flett: Work = {
  title: "Maize ear rot caused by Stenocarpella maydis",
  authors: [{ name: "B C Flett" }, { name: "Nicolaas W. McLaren" }, { name: "Frederik J. Wehner" }],
  year: 1998,
  venue: "Plant Disease",
  volume: "82",
  issue: "7",
  pages: "781-784",
  doi: "10.1094/PDIS.1998.82.7.781",
  source: "crossref",
  fetchedAt: "2026-10-15T00:00:00Z",
};

function memoryStore(): StyleStore & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return { saved, get: async (id) => saved.get(id) ?? null, put: async (id, _t, xml) => void saved.set(id, xml) };
}

describe("catálogo de estilos CSL", () => {
  it("tiene los 10 865 estilos del repositorio oficial y los incluidos existen", async () => {
    const c = await loadCatalog();
    expect(c.styles.length).toBe(10865);
    expect(c.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(c.included).toContain("apa");
    // Cada dependiente apunta a un estilo independiente que existe
    const ids = new Set(c.styles.filter((s) => !s.p).map((s) => s.id));
    expect(c.styles.filter((s) => s.p && !ids.has(s.p))).toEqual([]);
  });
  it("busca por nombre de revista sin importar tildes ni mayúsculas", async () => {
    const c = await loadCatalog();
    expect(searchStyles(c, "plant disease").map((s) => s.id)).toContain("plant-disease");
    expect(searchStyles(c, "biologia tropical")[0]!.id).toBe("revista-de-biologia-tropical");
    expect(searchStyles(c, "").length).toBeGreaterThan(10); // populares
    expect(isIncluded(c, "plant-disease")).toBe(true); // su padre (APS) viene incluido
    expect(isIncluded(c, "zootaxa")).toBe(false);
  });
});

describe("formato con citeproc-js", () => {
  it("APA 7: referencia, cita en el texto y orden alfabético", async () => {
    const st = await resolveStyle("apa");
    expect(st.origin).toBe("incluido");
    const b = await formatBibliography([huet, flett], st.xml, { lang: "en-US" });
    expect(b.text).toEqual([
      "Flett, B. C., McLaren, N. W., & Wehner, F. J. (1998). Maize ear rot caused by Stenocarpella maydis. Plant Disease, 82(7), 781–784. https://doi.org/10.1094/PDIS.1998.82.7.781",
      "Huet, G. (2014). Breeding for resistances to Ralstonia solanacearum. Frontiers in Plant Science, 5, 715. https://doi.org/10.3389/fpls.2014.00715",
    ]);
    expect(b.inText).toBe("(Flett et al., 1998; Huet, 2014)");
    expect(b.hangingIndent).toBe(true);
    // Cursivas para Word: revista y volumen
    expect(b.segs[1]!.filter((s) => s.italic).map((s) => s.text)).toEqual(["Frontiers in Plant Science", "5"]);
  });
  it("estilo dependiente (Plant Disease) usa el de la APS, sin internet", async () => {
    const st = await resolveStyle("plant-disease");
    expect(st.formatId).toBe("american-phytopathological-society");
    expect(st.origin).toBe("incluido");
    const b = await formatBibliography([flett], st.xml);
    expect(b.text[0]).toContain("Flett, B. C., McLaren, N. W., and Wehner, F. J. 1998.");
    // Sin lista de abreviaturas, el nombre de la revista va completo
    expect(b.text[0]).toContain("Plant Disease 82:781–784.");
  });
  it("Vancouver (NLM) numérico", async () => {
    const st = await resolveStyle("vancouver-nlm");
    const b = await formatBibliography([huet, flett], st.xml);
    expect(b.text[0]).toMatch(/^1\. Huet G\. Breeding for resistances to Ralstonia solanacearum\. Frontiers in Plant Science\. 2014;5:715\. doi:10\.3389\/fpls\.2014\.00715$/);
    expect(b.inText).toBe("(1,2)");
  });
  it("el idioma cambia los términos («y», «et al.»)", async () => {
    const st = await resolveStyle("iso690-author-date-es");
    const b = await formatBibliography([flett], st.xml, { lang: "es-ES" });
    expect(b.text[0]).toContain("FLETT");
    expect(nearestLocale("es")).toBe("es-ES");
    expect(nearestLocale("pt")).toBe("pt-BR");
    expect(nearestLocale("xx")).toBe("en-US");
  });
});

describe("estilos que no vienen incluidos", () => {
  it("se descargan del repositorio oficial (versión fija) y quedan guardados", async () => {
    const st = await resolveStyle("apa"); // usamos un XML real como respuesta
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(st.xml.replace("<title>APA Style 7th edition</title>", "<title>Zootaxa</title>"), { status: 200 });
    }) as unknown as typeof fetch;
    const store = memoryStore();
    const c = await loadCatalog();
    const r = await resolveStyle("zootaxa", { store, fetchFn });
    expect(calls).toEqual([styleUrl(c.commit, "zootaxa")]);
    expect(calls[0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/citation-style-language\/styles\/[0-9a-f]{40}\/zootaxa\.csl$/);
    expect(r.origin).toBe("descargado");
    expect(store.saved.has("zootaxa")).toBe(true);
    // La segunda vez no se descarga
    const again = await resolveStyle("zootaxa", { store, fetchFn });
    expect(again.origin).toBe("guardado");
    expect(calls.length).toBe(1);
  });
  it("informa el error si no hay conexión o la respuesta no es CSL", async () => {
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(resolveStyle("zootaxa", { fetchFn: offline })).rejects.toThrow(/No se pudo descargar el estilo «Zootaxa».*Failed to fetch/);
    const notFound = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(resolveStyle("zootaxa", { fetchFn: notFound })).rejects.toThrow(/respondió 404/);
    const html = (async () => new Response("<html>captcha</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(resolveStyle("zootaxa", { fetchFn: html })).rejects.toThrow(/no es un archivo CSL válido/);
  });
  it("estilos importados por el usuario (.csl), también dependientes", async () => {
    const store = memoryStore();
    const dep = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="es-ES">
  <info><title>Mi revista</title><id>http://www.zotero.org/styles/mi-revista</id>
  <link href="http://www.zotero.org/styles/mi-revista" rel="self"/>
  <link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info>
</style>`;
    expect(parseStyleXml(dep)).toMatchObject({ title: "Mi revista", id: "mi-revista", parentId: "apa", defaultLocale: "es-ES", valid: true });
    expect(parseStyleXml("<html></html>").valid).toBe(false);
    await store.put("importado:mi-revista", "Mi revista", dep, "importado");
    const r = await resolveStyle("importado:mi-revista", { store });
    expect(r).toMatchObject({ title: "Mi revista", formatId: "apa", origin: "importado" });
  });
});

describe("conversión del HTML de citeproc", () => {
  it("segmentos con formato, sin HTML", () => {
    const h = '<div class="csl-entry">A &#38; B. <i>Revista</i>, <b>5</b><span style="font-variant:small-caps;">X</span><sup>2</sup></div>';
    expect(htmlToRich(h)).toEqual([
      { text: "A & B. " }, { text: "Revista", i: true }, { text: ", " }, { text: "5", b: true }, { text: "X", sc: true }, { text: "2", sup: true },
    ]);
    expect(htmlToSegs(h).map((s) => [s.text, !!s.italic])).toEqual([["A & B. ", false], ["Revista", true], [", 5X2", false]]);
    // Nada ejecutable sobrevive
    expect(htmlToRich('<div class="csl-entry"><img src=x onerror=alert(1)>t&lt;script&gt;</div>').map((s) => s.text).join("")).toBe("t<script>");
  });
});
