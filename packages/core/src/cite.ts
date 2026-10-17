import { splitName } from "./export.ts";
import type { Work } from "./works.ts";

/**
 * Estilos de cita sin dependencias externas: APA 7 (español e inglés) y Vancouver.
 * El resultado son «segmentos» (texto con o sin cursiva) para poder escribir HTML y Word.
 */

export type StyleId = "apa-es" | "apa-en" | "vancouver";
export const STYLES: { id: StyleId; label: string }[] = [
  { id: "apa-es", label: "APA 7.ª edición (español)" },
  { id: "apa-en", label: "APA 7th edition (English)" },
  { id: "vancouver", label: "Vancouver (numérico)" },
];

export interface Seg {
  text: string;
  italic?: boolean;
}

/** Iniciales de los nombres: «Iván» → «I.», «Jean-Paul» → «J.-P.», «Nolan R.» → «N. R.» */
export function initials(given: string, withDots = true): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((p) => (p[0] ? p[0].toUpperCase() + (withDots ? "." : "") : ""))
        .join(withDots ? "-" : ""),
    )
    .join(withDots ? " " : "");
}

function apaName(name: string): string {
  const { family, given } = splitName(name);
  return given ? `${family}, ${initials(given)}` : family;
}

function vancouverName(name: string): string {
  const { family, given } = splitName(name);
  return given ? `${family} ${initials(given, false)}` : family;
}

const lastChar = (s: string) => s.trim().slice(-1);
const endWithDot = (s: string) => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

function apaAuthors(w: Work, lang: "es" | "en"): string {
  const names = w.authors.map((a) => apaName(a.name));
  const and = lang === "es" ? "y" : "&";
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]}, ${and} ${names[1]}`;
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, ${and} ${names.at(-1)}`;
  return `${names.slice(0, 19).join(", ")}, . . . ${names.at(-1)}`;
}

/** Referencia completa para la lista final. `yearSuffix` = «a», «b»… cuando hace falta desambiguar. */
export function formatReference(w: Work, style: StyleId, yearSuffix = ""): Seg[] {
  const doi = w.doi ? `https://doi.org/${w.doi}` : w.landingUrl ?? null;
  if (style === "vancouver") {
    const names = w.authors.map((a) => vancouverName(a.name));
    const authors = names.length > 6 ? `${names.slice(0, 6).join(", ")}, et al` : names.join(", ");
    const segs: Seg[] = [];
    if (authors) segs.push({ text: `${endWithDot(authors)} ` });
    segs.push({ text: `${endWithDot(w.title)} ` });
    if (w.venue) {
      let s = `${endWithDot(w.venue)} ${w.year ?? ""}`;
      if (w.volume) s += `;${w.volume}`;
      if (w.issue) s += `(${w.issue})`;
      if (w.pages) s += `:${w.pages}`;
      segs.push({ text: `${s.trim()}.` });
    } else if (w.year) segs.push({ text: `${w.year}.` });
    if (w.doi) segs.push({ text: ` doi:${w.doi}` });
    else if (w.landingUrl) segs.push({ text: ` Disponible en: ${w.landingUrl}` });
    return segs;
  }
  const lang = style === "apa-es" ? "es" : "en";
  const year = w.year ? `${w.year}${yearSuffix}` : `${lang === "es" ? "s. f." : "n.d."}${yearSuffix ? `-${yearSuffix}` : ""}`;
  const authors = apaAuthors(w, lang);
  const segs: Seg[] = [];
  if (authors) {
    segs.push({ text: `${authors}${lastChar(authors) === "." ? "" : "."} (${year}). ${endWithDot(w.title)}` });
  } else {
    // Sin autor: el título ocupa el lugar del autor
    segs.push({ text: `${endWithDot(w.title)} (${year}).` });
  }
  if (w.venue) {
    segs.push({ text: " " }, { text: w.venue, italic: true });
    if (w.volume) segs.push({ text: ", " }, { text: w.volume, italic: true });
    if (w.issue) segs.push({ text: `(${w.issue})` });
    if (w.pages) segs.push({ text: `, ${w.pages.replace(/-+/, "–")}` });
    segs.push({ text: "." });
  }
  if (doi) segs.push({ text: ` ${doi}` });
  return segs;
}

/** Etiqueta para la cita en el texto (APA): «Anderson et al., 2023». */
export function apaInText(w: Work, lang: "es" | "en", yearSuffix = ""): string {
  const fam = w.authors.map((a) => splitName(a.name).family);
  const year = w.year ? `${w.year}${yearSuffix}` : lang === "es" ? "s. f." : "n.d.";
  const who =
    fam.length === 0 ? `«${w.title.split(/\s+/).slice(0, 4).join(" ")}»` : fam.length === 1 ? fam[0]! : fam.length === 2 ? `${fam[0]} ${lang === "es" ? "y" : "&"} ${fam[1]}` : `${fam[0]} et al.`;
  return `${who}, ${year}`;
}

export const segsToText = (s: Seg[]) => s.map((x) => x.text).join("");

// ---------------- Procesar un manuscrito ----------------

export interface CitedDoc {
  /** Texto con las citas ya convertidas al estilo elegido */
  text: string;
  /** Lista de referencias en orden (alfabético en APA, de aparición en Vancouver) */
  references: { key: string; work: Work; segs: Seg[] }[];
  /** Claves citadas que no están en la biblioteca */
  missing: string[];
}

// Sin «[» ni saltos de línea dentro y con longitud máxima: tiempo lineal aun con texto malformado
const CITE_RE = /\[(@[^\][\n]{1,1000})\]/g;

/**
 * Reemplaza [@clave] y [@clave1; @clave2] por citas del estilo y arma la bibliografía.
 * `library` asocia cada clave a su publicación.
 */
export function processCitations(text: string, library: Map<string, Work>, style: StyleId): CitedDoc {
  const missing = new Set<string>();
  const order: string[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    for (const k of m[1]!.split(";").map((x) => x.trim().replace(/^@/, ""))) {
      if (!library.has(k)) missing.add(k);
      else if (!order.includes(k)) order.push(k);
    }
  }

  if (style === "vancouver") {
    const num = new Map(order.map((k, i) => [k, i + 1]));
    const out = text.replace(CITE_RE, (all, inner: string) => {
      const ns = inner.split(";").map((x) => num.get(x.trim().replace(/^@/, ""))).filter((n): n is number => !!n).sort((a, b) => a - b);
      if (!ns.length) return all;
      return `[${compressRanges(ns)}]`;
    });
    return { text: out, references: order.map((k) => ({ key: k, work: library.get(k)!, segs: formatReference(library.get(k)!, style) })), missing: [...missing] };
  }

  const lang = style === "apa-es" ? "es" : "en";
  // Desambiguar autor-año idénticos: 2020a, 2020b (ordenados por título)
  const sorted = [...order].sort((a, b) => {
    const A = library.get(a)!;
    const B = library.get(b)!;
    const fa = splitName(A.authors[0]?.name ?? A.title).family.localeCompare(splitName(B.authors[0]?.name ?? B.title).family, "es");
    return fa || (A.year ?? 0) - (B.year ?? 0) || A.title.localeCompare(B.title, "es");
  });
  const suffix = new Map<string, string>();
  const byLabel = new Map<string, string[]>();
  for (const k of sorted) {
    const label = apaInText(library.get(k)!, lang) + "|" + apaAuthors(library.get(k)!, lang);
    byLabel.set(label, [...(byLabel.get(label) ?? []), k]);
  }
  for (const ks of byLabel.values()) if (ks.length > 1) ks.forEach((k, i) => suffix.set(k, String.fromCharCode(97 + i)));
  const out = text.replace(CITE_RE, (all, inner: string) => {
    const ks = inner.split(";").map((x) => x.trim().replace(/^@/, "")).filter((k) => library.has(k));
    if (!ks.length) return all;
    ks.sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));
    return `(${ks.map((k) => apaInText(library.get(k)!, lang, suffix.get(k) ?? "")).join("; ")})`;
  });
  return { text: out, references: sorted.map((k) => ({ key: k, work: library.get(k)!, segs: formatReference(library.get(k)!, style, suffix.get(k) ?? "") })), missing: [...missing] };
}

function compressRanges(ns: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${ns[i]}-${ns[j]}` : ns.slice(i, j + 1).join(","));
    i = j + 1;
  }
  return parts.join(",");
}
