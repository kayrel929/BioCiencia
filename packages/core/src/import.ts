import { normalizeDoi } from "./identifiers.ts";
import type { Work } from "./works.ts";

/**
 * Importación de referencias desde archivos de Zotero, Mendeley, EndNote, JabRef, etc.
 * Lo que no se puede leer se informa en `warnings`; nunca se inventan campos.
 */

export type ImportFormat = "bibtex" | "ris" | "endnote";

export interface ImportResult {
  format: ImportFormat;
  works: Work[];
  warnings: string[];
}

export function detectFormat(text: string, fileName = ""): ImportFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "bib") return "bibtex";
  if (ext === "ris") return "ris";
  if (ext === "enw") return "endnote";
  const t = text.replace(/^﻿/, "").trimStart();
  if (/^TY {2}- /m.test(t)) return "ris";
  if (/^%0 /m.test(t)) return "endnote";
  if (/@\w+\s*[{(]/.test(t)) return "bibtex";
  return null;
}

export function parseReferences(text: string, fileName = ""): ImportResult {
  const fmt = detectFormat(text, fileName);
  if (!fmt) return { format: "ris", works: [], warnings: ["No se reconoce el formato. Use BibTeX (.bib), RIS (.ris) o EndNote (.enw)."] };
  if (fmt === "bibtex") return parseBibTeX(text);
  if (fmt === "endnote") return parseEndNote(text);
  return parseRIS(text);
}

const now = () => new Date().toISOString();
const year = (v: string | undefined) => {
  const m = v?.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
};

function finish(partial: Partial<Work> & { title?: string }, warnings: string[], index: number, fetchedAt: string): Work | null {
  const title = (partial.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) {
    warnings.push(`Referencia ${index + 1}: sin título, no se importó.`);
    return null;
  }
  const doi = normalizeDoi(partial.doi ?? null);
  if (partial.doi && !doi) warnings.push(`Referencia ${index + 1}: DOI no válido «${partial.doi}», se omitió.`);
  return {
    title,
    authors: partial.authors ?? [],
    year: partial.year ?? null,
    venue: partial.venue ?? null,
    doi,
    pmid: partial.pmid ?? null,
    abstract: partial.abstract ?? null,
    keywords: partial.keywords ?? [],
    type: partial.type ?? null,
    language: partial.language ?? null,
    landingUrl: partial.landingUrl ?? null,
    source: "import",
    fetchedAt,
  };
}

// ---------------- RIS ----------------

const RIS_TO_TYPE: Record<string, string> = { JOUR: "article", JFULL: "article", BOOK: "book", CHAP: "book-chapter", THES: "dissertation", DATA: "dataset", EJOUR: "article" };

export function parseRIS(text: string): ImportResult {
  const warnings: string[] = [];
  const works: Work[] = [];
  const at = now();
  let cur: Record<string, string[]> | null = null;
  let last = "";
  const flush = () => {
    if (!cur) return;
    const g = (k: string) => cur![k]?.[0];
    const w = finish(
      {
        title: g("TI") ?? g("T1") ?? g("CT"),
        authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])].map((name) => ({ name: name.trim() })).filter((a) => a.name),
        year: year(g("PY") ?? g("Y1") ?? g("DA")),
        venue: g("T2") ?? g("JO") ?? g("JF") ?? g("J2") ?? null,
        doi: g("DO") ?? (g("UR")?.match(/10\.\d{4,9}\/\S+/)?.[0] ?? undefined),
        abstract: g("AB") ?? g("N2") ?? null,
        keywords: cur.KW ?? [],
        type: RIS_TO_TYPE[g("TY") ?? ""] ?? null,
        language: g("LA") ?? null,
        pmid: g("AN")?.match(/PMID:?\s*(\d+)/i)?.[1] ?? null,
        landingUrl: g("UR") ?? null,
      },
      warnings,
      works.length + warnings.length,
      at,
    );
    if (w) works.push(w);
    cur = null;
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = raw.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (m) {
      const [, tag, val] = m as unknown as [string, string, string];
      if (tag === "TY") {
        flush();
        cur = { TY: [val.trim()] };
      } else if (tag === "ER") flush();
      else if (cur) (cur[tag] ??= []).push(val.trim());
      last = tag;
    } else if (cur && raw.trim() && last && cur[last]) {
      // Línea de continuación (resúmenes largos)
      const arr = cur[last]!;
      arr[arr.length - 1] += " " + raw.trim();
    }
  }
  flush();
  return { format: "ris", works, warnings };
}

// ---------------- EndNote (.enw) ----------------

const ENW_TO_TYPE: Record<string, string> = { "Journal Article": "article", Book: "book", "Book Section": "book-chapter", Thesis: "dissertation", Dataset: "dataset" };

export function parseEndNote(text: string): ImportResult {
  const warnings: string[] = [];
  const works: Work[] = [];
  const at = now();
  const blocks = text.replace(/^﻿/, "").split(/\r?\n\s*\r?\n/).filter((b) => /^%0 /m.test(b) || /^%T /m.test(b));
  blocks.forEach((b, i) => {
    const f: Record<string, string[]> = {};
    let last = "";
    for (const line of b.split(/\r?\n/)) {
      const m = line.match(/^%(\S) ?(.*)$/);
      if (m) {
        last = m[1]!;
        (f[last] ??= []).push((m[2] ?? "").trim());
      } else if (last && line.trim()) {
        if (last === "K") f.K!.push(line.trim());
        else f[last]![f[last]!.length - 1] += " " + line.trim();
      }
    }
    const g = (k: string) => f[k]?.[0];
    const w = finish(
      {
        title: g("T"),
        authors: (f.A ?? []).map((name) => ({ name })),
        year: year(g("D")),
        venue: g("J") ?? g("B") ?? g("I") ?? null,
        doi: g("R") ?? undefined,
        abstract: g("X") ?? null,
        keywords: (f.K ?? []).flatMap((k) => k.split(/\r?\n|;/)).map((k) => k.trim()).filter(Boolean),
        type: ENW_TO_TYPE[g("0") ?? ""] ?? null,
        language: g("G") ?? null,
        pmid: g("M")?.match(/^\d+$/)?.[0] ?? null,
        landingUrl: g("U") ?? null,
      },
      warnings,
      i,
      at,
    );
    if (w) works.push(w);
  });
  return { format: "endnote", works, warnings };
}

// ---------------- BibTeX ----------------

/** Quita llaves y comandos LaTeX frecuentes (acentos incluidos). */
export function latexToText(s: string): string {
  const acc: Record<string, Record<string, string>> = {
    "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", n: "ń", c: "ć" },
    "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù" },
    "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û" },
    '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" },
    "~": { n: "ñ", N: "Ñ", a: "ã", o: "õ" },
    c: { c: "ç", C: "Ç" },
  };
  return s
    .replace(/\\([`'^"~])\{?\\?([A-Za-z])\}?/g, (m, a: string, l: string) => acc[a]?.[l] ?? m)
    .replace(/\\c\{([cC])\}/g, (_m, l: string) => acc.c![l]!)
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\textasciicircum\{\}/g, "^")
    .replace(/\\\{/g, "\u0001")
    .replace(/\\\}/g, "\u0002")
    .replace(/\\([&%$#_])/g, "$1")
    .replace(/\\(textit|emph|textbf|mathrm|textrm)\{([^{}]*)\}/g, "$2")
    .replace(/[{}]/g, "")
    .replace(/\u0001/g, "{")
    .replace(/\u0002/g, "}")
    .replace(/\s+/g, " ")
    .trim();
}

const BIB_TO_TYPE: Record<string, string> = { article: "article", book: "book", incollection: "book-chapter", inbook: "book-chapter", phdthesis: "dissertation", mastersthesis: "dissertation", thesis: "dissertation", dataset: "dataset" };

export function parseBibTeX(text: string): ImportResult {
  const warnings: string[] = [];
  const works: Work[] = [];
  const at = now();
  const src = text.replace(/^﻿/, "");
  let i = 0;
  let index = 0;
  while ((i = src.indexOf("@", i)) !== -1) {
    const head = src.slice(i).match(/^@(\w+)\s*([{(])/);
    if (!head) {
      i++;
      continue;
    }
    const type = head[1]!.toLowerCase();
    const open = head[2]!;
    const close = open === "{" ? "}" : ")";
    let depth = 0;
    let j = i + head[0].length - 1;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === "{" || (open === "(" && ch === "(")) depth++;
      else if (ch === "}" || (open === "(" && ch === close)) {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(i + head[0].length, j);
    i = j + 1;
    if (["comment", "string", "preamble"].includes(type)) continue;
    const fields = parseBibFields(body);
    const w = finish(
      {
        title: fields.title ? latexToText(fields.title) : undefined,
        authors: (fields.author ? latexToText(fields.author) : "")
          .split(/\s+and\s+/i)
          .map((n) => n.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
        year: year(fields.year ?? fields.date),
        venue: fields.journal ? latexToText(fields.journal) : fields.journaltitle ? latexToText(fields.journaltitle) : fields.booktitle ? latexToText(fields.booktitle) : fields.school ? latexToText(fields.school) : null,
        doi: fields.doi ?? (fields.url?.match(/10\.\d{4,9}\/\S+/)?.[0] ?? undefined),
        abstract: fields.abstract ? latexToText(fields.abstract) : null,
        keywords: fields.keywords ? latexToText(fields.keywords).split(/[;,]/).map((k) => k.trim()).filter(Boolean) : [],
        type: BIB_TO_TYPE[type] ?? (type === "misc" ? null : null),
        language: fields.language ?? fields.langid ?? null,
        pmid: fields.pmid ?? null,
        landingUrl: fields.url ?? null,
      },
      warnings,
      index++,
      at,
    );
    if (w) works.push(w);
  }
  return { format: "bibtex", works, warnings };
}

/** Lee `clave = {valor}`, `clave = "valor"` o `clave = número` respetando llaves anidadas. */
function parseBibFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const comma = body.indexOf(",");
  let s = comma >= 0 ? body.slice(comma + 1) : "";
  const re = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) {
      const next = s.indexOf(",", pos);
      if (next === -1) break;
      pos = next + 1;
      continue;
    }
    const key = m[1]!.toLowerCase();
    pos = re.lastIndex;
    let val = "";
    const c = s[pos];
    if (c === "{") {
      let d = 0;
      let k = pos;
      for (; k < s.length; k++) {
        if (s[k] === "{") d++;
        else if (s[k] === "}") {
          d--;
          if (d === 0) break;
        }
      }
      val = s.slice(pos + 1, k);
      pos = k + 1;
    } else if (c === '"') {
      let k = pos + 1;
      let d = 0;
      for (; k < s.length; k++) {
        if (s[k] === "{") d++;
        else if (s[k] === "}") d--;
        else if (s[k] === '"' && d === 0) break;
      }
      val = s.slice(pos + 1, k);
      pos = k + 1;
    } else {
      const k = s.slice(pos).search(/[,\n]/);
      val = k === -1 ? s.slice(pos) : s.slice(pos, pos + k);
      pos = k === -1 ? s.length : pos + k;
    }
    out[key] = val.replace(/\s+/g, " ").trim();
    const next = s.indexOf(",", pos);
    pos = next === -1 ? s.length : next + 1;
  }
  s = "";
  return out;
}
