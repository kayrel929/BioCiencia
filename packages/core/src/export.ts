import type { AuthorRef, Work } from "./works.ts";

/**
 * Exportación de referencias a formatos estándar que leen Zotero, Mendeley,
 * EndNote, JabRef, LaTeX y Excel. Solo se exportan datos que existen; nunca
 * se completan campos ausentes.
 */

/** Separa un nombre en apellido y nombres. "Pérez, María" o "María Pérez". */
export function splitName(name: string): { family: string; given: string } {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.includes(",")) {
    const [family, ...rest] = n.split(",");
    return { family: (family ?? "").trim(), given: rest.join(",").trim() };
  }
  const parts = n.split(" ");
  if (parts.length === 1) return { family: n, given: "" };
  // Partículas frecuentes en apellidos (de, da, van, von, del…)
  const particles = new Set(["de", "da", "do", "dos", "das", "del", "della", "di", "van", "von", "der", "den", "la", "le", "du"]);
  let i = parts.length - 1;
  while (i > 1 && particles.has((parts[i - 1] ?? "").toLowerCase())) i--;
  return { family: parts.slice(i).join(" "), given: parts.slice(0, i).join(" ") };
}

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");

/** Escapa caracteres especiales de LaTeX conservando Unicode (BibLaTeX y Zotero leen UTF-8). */
export function bibEscape(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}&%$#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\s+/g, " ")
    .trim();
}

const BIB_TYPE: Record<string, string> = {
  article: "article",
  review: "article",
  letter: "article",
  editorial: "article",
  book: "book",
  "book-chapter": "incollection",
  dissertation: "phdthesis",
  preprint: "misc",
  dataset: "misc",
};

function bibAuthors(a: AuthorRef[]): string {
  return a.map((x) => {
    const { family, given } = splitName(x.name);
    return given ? `${bibEscape(family)}, ${bibEscape(given)}` : `{${bibEscape(family)}}`;
  }).join(" and ");
}

/** Genera claves únicas tipo apellido2023palabra (sin acentos). */
export function citationKeys(works: Work[]): string[] {
  const used = new Map<string, number>();
  return works.map((w) => {
    const fam = ascii(splitName(w.authors[0]?.name ?? "anonimo").family).toLowerCase() || "anonimo";
    const word = ascii((w.title.split(/\s+/).find((t) => t.replace(/[^\p{L}]/gu, "").length > 3) ?? "")).toLowerCase();
    const base = `${fam}${w.year ?? "sf"}${word}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}${String.fromCharCode(97 + ((n - 1) % 26))}${n > 26 ? n : ""}`;
  });
}

export function toBibTeX(works: Work[]): string {
  const keys = citationKeys(works);
  return works
    .map((w, i) => {
      const type = BIB_TYPE[w.type ?? ""] ?? (w.venue ? "article" : "misc");
      const f: [string, string | null | undefined][] = [
        ["title", w.title ? `{${bibEscape(w.title)}}` : null],
        ["author", w.authors.length ? bibAuthors(w.authors) : null],
        [type === "incollection" ? "booktitle" : type === "phdthesis" ? "school" : "journal", w.venue ? bibEscape(w.venue) : null],
        ["year", w.year ? String(w.year) : null],
        ["volume", w.volume],
        ["number", w.issue],
        ["pages", w.pages ? w.pages.replace(/[-–]+/, "--") : null],
        ["doi", w.doi],
        ["url", w.doi ? `https://doi.org/${w.doi}` : w.landingUrl],
        ["pmid", w.pmid],
        ["abstract", w.abstract ? bibEscape(w.abstract) : null],
        ["keywords", w.keywords?.length ? bibEscape(w.keywords.join(", ")) : null],
        ["language", w.language],
        ["note", w.type === "preprint" ? "Preprint" : null],
      ];
      const body = f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
      return `@${type}{${keys[i]},\n${body}\n}`;
    })
    .join("\n\n") + "\n";
}

const RIS_TYPE: Record<string, string> = {
  article: "JOUR", review: "JOUR", letter: "JOUR", editorial: "JOUR",
  book: "BOOK", "book-chapter": "CHAP", dissertation: "THES", dataset: "DATA", preprint: "JOUR",
};

export function toRIS(works: Work[]): string {
  const lines: string[] = [];
  for (const w of works) {
    const add = (tag: string, v: string | number | null | undefined) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") lines.push(`${tag}  - ${String(v).replace(/\r?\n/g, " ").trim()}`);
    };
    add("TY", RIS_TYPE[w.type ?? ""] ?? (w.venue ? "JOUR" : "GEN"));
    add("TI", w.title);
    for (const a of w.authors) {
      const { family, given } = splitName(a.name);
      add("AU", given ? `${family}, ${given}` : family);
    }
    add("T2", w.venue);
    add("PY", w.year);
    add("VL", w.volume);
    add("IS", w.issue);
    if (w.pages) {
      const [sp, ep] = w.pages.split(/[-–]+/);
      add("SP", sp);
      add("EP", ep);
    }
    add("DO", w.doi);
    add("UR", w.doi ? `https://doi.org/${w.doi}` : w.landingUrl);
    add("AB", w.abstract);
    for (const k of w.keywords ?? []) add("KW", k);
    add("LA", w.language);
    if (w.pmid) add("AN", `PMID:${w.pmid}`);
    lines.push("ER  - ", "");
  }
  return lines.join("\r\n");
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con BOM para que Excel en español abra bien los acentos. */
export function toCSV(works: Work[]): string {
  const header = ["titulo", "autores", "anio", "revista", "doi", "tipo", "citas", "acceso_abierto", "url", "resumen", "palabras_clave", "fuente", "fecha_datos"];
  const rows = works.map((w) => [
    w.title, w.authors.map((a) => a.name).join("; "), w.year, w.venue, w.doi, w.type, w.citedByCount,
    w.isOpenAccess === null || w.isOpenAccess === undefined ? "" : w.isOpenAccess ? "sí" : "no",
    w.doi ? `https://doi.org/${w.doi}` : w.landingUrl, w.abstract, (w.keywords ?? []).join("; "), w.source, w.fetchedAt,
  ].map(csvCell).join(","));
  return "﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n";
}

const CSL_TYPE: Record<string, string> = {
  article: "article-journal", review: "article-journal", book: "book", "book-chapter": "chapter",
  dissertation: "thesis", dataset: "dataset", preprint: "article",
};

/** CSL-JSON: formato que usan Zotero y los motores de citas (APA, Vancouver…). */
export function toCslJson(works: Work[]): string {
  const keys = citationKeys(works);
  return JSON.stringify(
    works.map((w, i) => ({
      id: keys[i],
      type: CSL_TYPE[w.type ?? ""] ?? "article-journal",
      title: w.title,
      author: w.authors.map((a) => {
        const { family, given } = splitName(a.name);
        return given ? { family, given } : { literal: family };
      }),
      ...(w.venue ? { "container-title": w.venue } : {}),
      ...(w.year ? { issued: { "date-parts": [[w.year]] } } : {}),
      ...(w.volume ? { volume: w.volume } : {}),
      ...(w.issue ? { issue: w.issue } : {}),
      ...(w.pages ? { page: w.pages } : {}),
      ...(w.doi ? { DOI: w.doi, URL: `https://doi.org/${w.doi}` } : w.landingUrl ? { URL: w.landingUrl } : {}),
      ...(w.abstract ? { abstract: w.abstract } : {}),
      ...(w.pmid ? { PMID: w.pmid } : {}),
      ...(w.language ? { language: w.language } : {}),
    })),
    null,
    2,
  );
}

// ---------------- EndNote ----------------

const ENW_TYPE: Record<string, string> = {
  article: "Journal Article", review: "Journal Article", letter: "Journal Article", editorial: "Journal Article",
  preprint: "Journal Article", book: "Book", "book-chapter": "Book Section", dissertation: "Thesis", dataset: "Dataset",
};

/** Formato etiquetado de EndNote (.enw): EndNote lo abre con doble clic o «Importar». */
export function toEndNote(works: Work[]): string {
  const out: string[] = [];
  for (const w of works) {
    const add = (tag: string, v: string | number | null | undefined) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") out.push(`%${tag} ${String(v).replace(/\r?\n/g, " ").trim()}`);
    };
    const type = ENW_TYPE[w.type ?? ""] ?? (w.venue ? "Journal Article" : "Generic");
    add("0", type);
    add("T", w.title);
    for (const a of w.authors) {
      const { family, given } = splitName(a.name);
      add("A", given ? `${family}, ${given}` : family);
    }
    add(type === "Book Section" ? "B" : type === "Thesis" ? "I" : "J", w.venue);
    add("D", w.year);
    add("V", w.volume);
    add("N", w.issue);
    add("P", w.pages);
    add("R", w.doi);
    add("U", w.doi ? `https://doi.org/${w.doi}` : w.landingUrl);
    add("X", w.abstract);
    for (const k of w.keywords ?? []) add("K", k);
    add("G", w.language);
    add("M", w.pmid);
    out.push("");
  }
  return out.join("\r\n");
}

const ENX_TYPE: Record<string, [number, string]> = {
  "Journal Article": [17, "Journal Article"], Book: [6, "Book"], "Book Section": [5, "Book Section"],
  Thesis: [32, "Thesis"], Dataset: [59, "Dataset"], Generic: [13, "Generic"],
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** EndNote XML: en EndNote, Archivo → Importar → «EndNote generated XML». */
export function toEndNoteXML(works: Work[]): string {
  const recs = works.map((w, i) => {
    const typeName = ENW_TYPE[w.type ?? ""] ?? (w.venue ? "Journal Article" : "Generic");
    const [num, name] = ENX_TYPE[typeName] ?? [13, "Generic"];
    const parts: string[] = [`<rec-number>${i + 1}</rec-number>`, `<ref-type name="${name}">${num}</ref-type>`];
    if (w.authors.length) {
      parts.push(`<contributors><authors>${w.authors.map((a) => {
        const { family, given } = splitName(a.name);
        return `<author>${xml(given ? `${family}, ${given}` : family)}</author>`;
      }).join("")}</authors></contributors>`);
    }
    parts.push(`<titles><title>${xml(w.title)}</title>${w.venue ? `<secondary-title>${xml(w.venue)}</secondary-title>` : ""}</titles>`);
    if (w.venue) parts.push(`<periodical><full-title>${xml(w.venue)}</full-title></periodical>`);
    if (w.keywords?.length) parts.push(`<keywords>${w.keywords.map((k) => `<keyword>${xml(k)}</keyword>`).join("")}</keywords>`);
    if (w.pages) parts.push(`<pages>${xml(w.pages)}</pages>`);
    if (w.volume) parts.push(`<volume>${xml(w.volume)}</volume>`);
    if (w.issue) parts.push(`<number>${xml(w.issue)}</number>`);
    if (w.year) parts.push(`<dates><year>${w.year}</year></dates>`);
    if (w.pmid) parts.push(`<accession-num>${xml(w.pmid)}</accession-num>`);
    if (w.abstract) parts.push(`<abstract>${xml(w.abstract)}</abstract>`);
    if (w.doi) parts.push(`<electronic-resource-num>${xml(w.doi)}</electronic-resource-num>`);
    const url = w.doi ? `https://doi.org/${w.doi}` : w.landingUrl;
    if (url) parts.push(`<urls><related-urls><url>${xml(url)}</url></related-urls></urls>`);
    if (w.language) parts.push(`<language>${xml(w.language)}</language>`);
    return `<record>${parts.join("")}</record>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>\n${recs.join("\n")}\n</records></xml>\n`;
}
