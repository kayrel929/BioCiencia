import CSL from "citeproc";
import { citationKeys, toCslJson, type Seg, type Work } from "@biociencia/core";

/**
 * Estilos de cita CSL (Citation Style Language), el mismo estándar abierto que usan Zotero y Mendeley.
 *  - El catálogo lista los 10 865 estilos del repositorio oficial (https://citationstyles.org/, CC BY-SA 3.0).
 *  - 41 estilos vienen incluidos y, con sus estilos dependientes, cubren unos 4 800 sin internet.
 *  - Los demás se descargan al elegirlos (desde el repositorio oficial, en la versión fija del catálogo)
 *    y quedan guardados en la computadora.
 *  - Motor: citeproc-js (Frank Bennett, licencia CPAL 1.0).
 */

export interface CslStyleInfo {
  id: string;
  /** Título */
  t: string;
  /** Título corto */
  s?: string;
  /** Estilo «padre» (los estilos dependientes solo cambian el nombre de la revista) */
  p?: string;
  /** Formato de cita: author-date, numeric, note, label, author */
  c?: string;
  /** Áreas */
  f?: string[];
  /** Idioma por defecto */
  l?: string;
}

export interface CslCatalog {
  commit: string;
  generated: string;
  included: string[];
  styles: CslStyleInfo[];
}

export const CSL_FORMAT_LABEL: Record<string, string> = {
  "author-date": "Autor-año",
  numeric: "Numérico",
  note: "Notas al pie",
  label: "Etiqueta",
  author: "Autor",
};

export const CSL_LOCALES: { id: string; label: string }[] = [
  { id: "es-ES", label: "Español (España)" },
  { id: "es-MX", label: "Español (México)" },
  { id: "es-CL", label: "Español (Chile)" },
  { id: "en-US", label: "Inglés (EE. UU.)" },
  { id: "en-GB", label: "Inglés (Reino Unido)" },
  { id: "pt-BR", label: "Portugués (Brasil)" },
  { id: "pt-PT", label: "Portugués (Portugal)" },
  { id: "fr-FR", label: "Francés" },
  { id: "de-DE", label: "Alemán" },
  { id: "it-IT", label: "Italiano" },
];

/** Estilos propuestos al abrir el selector. */
export const POPULAR_STYLES = [
  "apa", "nlm-citation-sequence", "vancouver-nlm", "ieee", "chicago-author-date", "harvard-cite-them-right", "iso690-author-date-es",
  "american-phytopathological-society", "plant-disease", "phytopathology", "asa-cssa-sssa", "agronomy-journal", "iica-catie",
  "scientia-horticulturae", "elsevier-harvard", "springer-basic-author-date", "nature", "science", "plos", "frontiers",
  "multidisciplinary-digital-publishing-institute", "associacao-brasileira-de-normas-tecnicas", "modern-language-association",
];

const styleFiles = import.meta.glob<string>("./styles/*.csl", { query: "?raw", import: "default" });
const localeFiles = import.meta.glob<string>("./locales/*.xml", { query: "?raw", import: "default" });

let catalogPromise: Promise<CslCatalog> | null = null;
export function loadCatalog(): Promise<CslCatalog> {
  catalogPromise ??= import("./catalog.json").then((m) => (m.default ?? m) as unknown as CslCatalog);
  return catalogPromise;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca en el catálogo por nombre de revista, editorial, norma o identificador. */
export function searchStyles(catalog: CslCatalog, query: string, limit = 60): CslStyleInfo[] {
  const q = norm(query.trim());
  if (!q) {
    const byId = new Map(catalog.styles.map((s) => [s.id, s]));
    return POPULAR_STYLES.map((id) => byId.get(id)).filter((s): s is CslStyleInfo => !!s);
  }
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { s: CslStyleInfo; score: number }[] = [];
  for (const s of catalog.styles) {
    const hay = norm(`${s.t} ${s.s ?? ""} ${s.id}`);
    if (!words.every((w) => hay.includes(w))) continue;
    const title = norm(s.t);
    let score = 0;
    if (title === q || norm(s.s ?? "") === q || s.id === q) score += 100;
    if (title.startsWith(q)) score += 30;
    if (!s.p) score += 5; // los estilos generales primero
    score -= title.length / 100;
    scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

/** Dónde se guardan los estilos descargados o importados (la base de datos local). */
export interface StyleStore {
  get(id: string): Promise<string | null>;
  put(id: string, title: string, xml: string, origin: "descargado" | "importado"): Promise<void>;
}

export function styleUrl(commit: string, id: string): string {
  return `https://raw.githubusercontent.com/citation-style-language/styles/${commit}/${encodeURIComponent(id)}.csl`;
}

export function isIncluded(catalog: CslCatalog, id: string): boolean {
  const s = catalog.styles.find((x) => x.id === id);
  const real = s?.p ?? id;
  return catalog.included.includes(real);
}

export interface ResolvedStyle {
  /** Estilo elegido (puede ser dependiente) */
  id: string;
  title: string;
  /** Estilo que realmente da el formato */
  formatId: string;
  xml: string;
  origin: "incluido" | "guardado" | "descargado" | "importado";
}

/** Obtiene el XML de un estilo: incluido → guardado en la computadora → descarga del repositorio oficial. */
export async function resolveStyle(
  id: string,
  opts: { store?: StyleStore; fetchFn?: typeof fetch; catalog?: CslCatalog } = {},
): Promise<ResolvedStyle> {
  const catalog = opts.catalog ?? (await loadCatalog());
  const info = catalog.styles.find((s) => s.id === id);
  // Estilo importado por el usuario (no está en el catálogo)
  if (!info) {
    const xml = await opts.store?.get(id);
    if (!xml) throw new Error(`No se encontró el estilo «${id}».`);
    const meta = parseStyleXml(xml);
    if (meta.parentId) {
      const parent = await resolveStyle(meta.parentId, opts);
      return { ...parent, id, title: meta.title || id, origin: "importado" };
    }
    return { id, title: meta.title || id, formatId: id, xml, origin: "importado" };
  }
  const formatId = info.p ?? id;
  const file = styleFiles[`./styles/${formatId}.csl`];
  if (file) return { id, title: info.t, formatId, xml: await file(), origin: "incluido" };
  const saved = await opts.store?.get(formatId);
  if (saved) return { id, title: info.t, formatId, xml: saved, origin: "guardado" };
  const f = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(styleUrl(catalog.commit, formatId));
  } catch (e) {
    throw new Error(`No se pudo descargar el estilo «${info.t}» (sin conexión o bloqueado): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`No se pudo descargar el estilo «${info.t}»: el repositorio respondió ${res.status}.`);
  const xml = await res.text();
  if (!/<style[\s>]/.test(xml)) throw new Error(`La descarga del estilo «${info.t}» no es un archivo CSL válido.`);
  const parent = catalog.styles.find((s) => s.id === formatId);
  await opts.store?.put(formatId, parent?.t ?? info.t, xml, "descargado");
  return { id, title: info.t, formatId, xml, origin: "descargado" };
}

const unesc = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** Datos básicos de un archivo .csl (para importar estilos propios). */
export function parseStyleXml(xml: string): { title: string; id: string | null; parentId: string | null; defaultLocale: string | null; valid: boolean } {
  const valid = /<style[\s>][\s\S]*<info>[\s\S]*<\/info>/.test(xml) && /xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/.test(xml);
  const info = xml.slice(0, Math.max(0, xml.indexOf("</info>")));
  const title = unesc(info.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim();
  const idUrl = info.match(/<id>([^<]*)<\/id>/)?.[1] ?? null;
  const id = idUrl ? idUrl.replace(/^https?:\/\/www\.zotero\.org\/styles\//, "").trim() : null;
  const parentId =
    info.match(/<link[^>]*href="https?:\/\/www\.zotero\.org\/styles\/([^"]+)"[^>]*rel="independent-parent"/)?.[1] ??
    info.match(/<link[^>]*rel="independent-parent"[^>]*href="https?:\/\/www\.zotero\.org\/styles\/([^"]+)"/)?.[1] ??
    null;
  const defaultLocale = xml.match(/<style[^>]*default-locale="([^"]+)"/)?.[1] ?? null;
  return { title, id, parentId, defaultLocale, valid };
}

// ---------------- Formato ----------------

async function loadLocales(wanted: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const l of new Set(wanted)) {
    const f = localeFiles[`./locales/locales-${l}.xml`];
    if (f) out.set(l, await f());
  }
  return out;
}

/** Idioma disponible más cercano: «es» → es-ES, «pt» → pt-BR. */
export function nearestLocale(lang: string | null | undefined): string {
  if (!lang) return "en-US";
  const exact = CSL_LOCALES.find((l) => l.id.toLowerCase() === lang.toLowerCase());
  if (exact) return exact.id;
  const base = lang.slice(0, 2).toLowerCase();
  return CSL_LOCALES.find((l) => l.id.toLowerCase().startsWith(base))?.id ?? "en-US";
}

export interface FormattedBibliography {
  /** Una entrada HTML por referencia, en el orden del estilo */
  html: string[];
  /** Las mismas entradas en texto simple */
  text: string[];
  /** Las mismas entradas con cursivas, para Word */
  segs: Seg[][];
  /** Cita en el texto para todas las referencias juntas, p. ej. «(Huet et al., 2014; Pérez, 2020)» */
  inText: string;
  /** Sangría francesa sugerida por el estilo */
  hangingIndent: boolean;
  /** El estilo es de notas al pie */
  isNote: boolean;
  /** Advertencias del motor (datos que faltan) */
  errors: string[];
}

/**
 * Da formato a una lista de publicaciones con un estilo CSL.
 * `lang` fuerza el idioma (por ejemplo es-ES); si se omite, se usa el del estilo.
 */
export async function formatBibliography(works: Work[], styleXml: string, opts: { lang?: string | null } = {}): Promise<FormattedBibliography> {
  if (works.length === 0) return { html: [], text: [], segs: [], inText: "", hangingIndent: false, isNote: false, errors: [] };
  const items = JSON.parse(toCslJson(works)) as { id: string }[];
  const byId = new Map(items.map((it) => [it.id, it]));
  const meta = parseStyleXml(styleXml);
  const lang = opts.lang ? nearestLocale(opts.lang) : nearestLocale(meta.defaultLocale);
  const locales = await loadLocales([lang, "en-US", nearestLocale(meta.defaultLocale)]);
  const sys = {
    retrieveLocale: (l: string) => locales.get(l) ?? locales.get(nearestLocale(l)) ?? locales.get("en-US") ?? null,
    retrieveItem: (id: string) => byId.get(id),
  };
  const ids = items.map((it) => it.id);
  const make = (format: "html" | "text") => {
    const engine = new CSL.Engine(sys, styleXml, lang, !!opts.lang);
    engine.setOutputFormat(format);
    engine.updateItems(ids);
    const bib = engine.makeBibliography();
    const cite = engine.makeCitationCluster(ids.map((id) => ({ id })));
    return { bib, cite };
  };
  const h = make("html");
  const t = make("text");
  if (!h.bib) {
    // Algunos estilos (notas sin bibliografía) no producen lista: se usan las citas individuales
    return { html: [], text: [], segs: [], inText: htmlToText(String(h.cite ?? "")), hangingIndent: false, isNote: true, errors: ["Este estilo no define una lista de referencias."] };
  }
  const [hMeta, hEntries] = h.bib as [{ hangingindent?: boolean; bibliography_errors?: unknown[] }, string[]];
  const [, tEntries] = t.bib as [unknown, string[]];
  const html = hEntries.map((e) => e.trim());
  return {
    html,
    text: tEntries.map((e) => e.trim()),
    segs: html.map(htmlToSegs),
    inText: String(t.cite ?? "").trim(),
    hangingIndent: !!hMeta.hangingindent,
    isNote: /class="note"/.test(styleXml),
    errors: (hMeta.bibliography_errors ?? []).map((e) => JSON.stringify(e)),
  };
}

/** Quita etiquetas y entidades del HTML que produce citeproc. */
export function htmlToText(html: string): string {
  return unesc(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Convierte una entrada HTML de citeproc en segmentos con cursiva para el documento Word. */
export function htmlToSegs(html: string): Seg[] {
  const inner = html.replace(/^\s*<div class="csl-entry">/, "").replace(/<\/div>\s*$/, "");
  const segs: Seg[] = [];
  let italic = 0;
  for (const part of inner.split(/(<[^>]+>)/)) {
    if (!part) continue;
    if (part.startsWith("<")) {
      if (/^<i[\s>]|^<em[\s>]|font-style:\s*italic/.test(part)) italic++;
      else if (/^<\/(i|em)>/.test(part) && italic > 0) italic--;
      continue;
    }
    const text = unesc(part);
    const last = segs[segs.length - 1];
    if (last && !!last.italic === italic > 0) last.text += text;
    else segs.push(italic > 0 ? { text, italic: true } : { text });
  }
  if (segs[0]) segs[0].text = segs[0].text.replace(/^\s+/, "");
  return segs;
}

export interface RichSeg {
  text: string;
  i?: boolean;
  b?: boolean;
  sc?: boolean;
  sup?: boolean;
  sub?: boolean;
}

/**
 * Convierte el HTML de citeproc en segmentos con formato (cursiva, negrita, versalitas, superíndice, subíndice)
 * para mostrarlos con React sin insertar HTML en la página.
 */
export function htmlToRich(html: string): RichSeg[] {
  const inner = html.replace(/^\s*<div class="csl-entry">/, "").replace(/<\/div>\s*$/, "");
  const out: RichSeg[] = [];
  const stack: (keyof Omit<RichSeg, "text"> | null)[] = [];
  const active = () => {
    const f: Omit<RichSeg, "text"> = {};
    for (const k of stack) if (k) f[k] = true;
    return f;
  };
  for (const part of inner.split(/(<[^>]+>)/)) {
    if (!part) continue;
    if (part.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (part.startsWith("<")) {
      if (/\/>$/.test(part)) continue;
      const tag = part.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? "";
      let k: keyof Omit<RichSeg, "text"> | null = null;
      if (tag === "i" || tag === "em" || /font-style:\s*italic/.test(part)) k = "i";
      else if (tag === "b" || tag === "strong" || /font-weight:\s*bold/.test(part)) k = "b";
      else if (/small-caps/.test(part)) k = "sc";
      else if (tag === "sup") k = "sup";
      else if (tag === "sub") k = "sub";
      stack.push(k);
      continue;
    }
    out.push({ text: unesc(part), ...active() });
  }
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, "");
  return out.filter((s) => s.text);
}

/** Claves de cita estables (las mismas que en BibTeX y CSL-JSON). */
export { citationKeys };
