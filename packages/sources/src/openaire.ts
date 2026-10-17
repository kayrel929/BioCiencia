import { normalizeDoi, normalizePmid, type AuthorRef, type Work } from "@biociencia/core";
import { clampPerPage, getText, lang2, parseJson, SourceError, stripTags, type FreeSearchParams, type FreeSearchResult, type FreeSource } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * OpenAIRE (https://graph.openaire.eu/docs/) — gratuito y sin clave. Reúne publicaciones y tesis de
 * repositorios de todo el mundo (incluye muchos de Latinoamérica y España). Comprobado el 2026-10-17:
 * admite búsqueda por palabras, rango de años, filtro de acceso abierto y orden por popularidad.
 */
export const OPENAIRE_BASE = "https://api.openaire.eu/search/publications";

/** OpenAIRE une las palabras con Y; se quitan los caracteres que romperían su consulta. */
export function openaireQuery(text: string): string {
  return text.replace(/["'()<>[\]{}/\\^~:!?*|]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildOpenaireUrl(p: FreeSearchParams): string {
  const q = openaireQuery(p.text);
  if (!q) throw new SourceError("openaire", "Escriba alguna palabra para buscar en OpenAIRE.", null);
  const qs = new URLSearchParams({
    keywords: q,
    format: "json",
    size: String(clampPerPage(p.perPage, 50)),
    page: String(Math.max(p.page ?? 1, 1)),
  });
  const { yearFrom, yearTo, openAccess } = p.filters ?? {};
  if (yearFrom) qs.set("fromDateAccepted", `${yearFrom}-01-01`);
  if (yearTo) qs.set("toDateAccepted", `${yearTo}-12-31`);
  if (openAccess) qs.set("OA", "true");
  if (p.sort === "cited") qs.set("sortBy", "popularity,descending");
  return `${OPENAIRE_BASE}?${qs}`;
}

type Oaf = any;

/** OpenAIRE envía algunos campos como objeto y otros como lista: aquí siempre se trabaja con lista. */
function listOf(v: Oaf): Oaf[] {
  return Array.isArray(v) ? v.filter((x) => x != null) : v == null ? [] : [v];
}

function firstOf(v: Oaf): Oaf {
  return listOf(v)[0];
}

/**
 * Texto de un campo de OpenAIRE (el valor va en «$»). A veces antepone «null » al nombre
 * (por ejemplo «null Pratibha Sharma»): se quita para dejar el dato limpio.
 */
function fieldText(v: Oaf): string | null {
  const o = firstOf(v);
  const raw = typeof o === "string" || typeof o === "number" ? String(o) : o?.$ != null ? String(o.$) : null;
  const s = (raw ?? "").replace(/^null\s+/i, "").trim();
  return s || null;
}

/** Nombre de atributo (por ejemplo la revista en «hostedby @name»). */
function attrName(v: Oaf): string | null {
  const o = firstOf(v);
  const s = o?.["@name"] ?? o?.["@classname"] ?? null;
  return s == null ? null : String(s).trim() || null;
}

/** Código corto de un campo con atributos (por ejemplo el idioma en «language @classid»). */
function attrId(v: Oaf): string | null {
  const o = firstOf(v);
  const s = o?.["@classid"] ?? null;
  return s == null ? null : String(s).trim() || null;
}

/** Primera copia (instance) del registro: de ahí salen la revista y el enlace. */
function firstInstance(res: Oaf): Oaf | null {
  for (const child of listOf(res?.children?.result)) {
    const inst = firstOf(child?.instance);
    if (inst) return inst;
  }
  return null;
}

export function parseOpenaireWork(r: Oaf, fetchedAt: string): Work {
  const res = r?.metadata?.["oaf:entity"]?.["oaf:result"] ?? {};
  const inst = firstInstance(res);
  const authors: AuthorRef[] = listOf(res.creator)
    .map((c) => ({ name: fieldText(c) ?? "" }))
    .filter((a) => a.name);
  const pids = listOf(res.pid);
  const pidOf = (kind: string) => firstOf(pids.filter((p) => String(p?.["@classid"] ?? "").toLowerCase() === kind));
  const doi = normalizeDoi(fieldText(pidOf("doi")));
  const pmid = normalizePmid(fieldText(pidOf("pmid")));
  const citation = listOf(res.measure).find((m) => m?.["@id"] === "citationCount");
  const score = fieldText(citation?.["@score"]);
  const date = fieldText(res.dateofacceptance);
  const webUrl = fieldText(inst?.url) ?? fieldText(inst?.webresource?.url);
  return {
    title: stripTags(fieldText(res.title)) || "(sin título)",
    authors,
    year: date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
    venue: attrName(inst?.hostedby),
    doi,
    pmid,
    abstract: stripTags(fieldText(res.description)) || null,
    type: "article",
    language: lang2(attrId(res.language)),
    citedByCount: score != null && Number.isFinite(Number(score)) ? Number(score) : null,
    isOpenAccess: String(attrId(res.bestaccessright) ?? "").toUpperCase() === "OPEN",
    oaUrl: null,
    landingUrl: webUrl ?? (doi ? `https://doi.org/${doi}` : null),
    source: "openaire",
    fetchedAt,
  };
}

export class OpenaireClient implements FreeSource {
  readonly id = "openaire" as const;
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number } = {},
  ) {}

  async search(p: FreeSearchParams): Promise<FreeSearchResult> {
    const url = buildOpenaireUrl(p);
    const body = parseJson("openaire", (await getText(this.http, "openaire", url, this.opts.timeoutMs ?? 25_000)).text);
    const at = (this.opts.now?.() ?? new Date()).toISOString();
    return {
      source: "openaire",
      works: listOf(body?.response?.results?.result).map((r) => parseOpenaireWork(r, at)),
      total: Number(fieldText(body?.response?.header?.total) ?? 0) || 0,
      url,
    };
  }
}
