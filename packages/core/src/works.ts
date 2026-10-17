import { normalizeArxivId, normalizeDoi, normalizeOpenAlexId, normalizePmid, normalizeTitle } from "./identifiers.ts";

/** Fuentes de metadatos conocidas. "manual" = escrito o importado por el usuario. */
export type SourceName = "openalex" | "crossref" | "pubmed" | "europepmc" | "semanticscholar" | "arxiv" | "openaire" | "doaj" | "orcid" | "manual" | "import";

export interface AuthorRef {
  name: string;
  orcid?: string | null;
  openalexId?: string | null;
  /** Correo publicado en la afiliación (Europe PMC / PubMed lo incluyen a veces para el autor de correspondencia) */
  email?: string | null;
}

/** Publicación científica tal como la guarda BioCiencia. */
export interface Work {
  id?: string; // asignado por la base de datos local (ULID)
  title: string;
  authors: AuthorRef[];
  year?: number | null;
  venue?: string | null; // revista o fuente
  volume?: string | null;
  issue?: string | null;
  pages?: string | null; // «76-87» o número de artículo
  doi?: string | null;
  pmid?: string | null;
  openalexId?: string | null;
  arxivId?: string | null;
  abstract?: string | null;
  keywords?: string[];
  type?: string | null; // article, review, preprint…
  language?: string | null;
  citedByCount?: number | null;
  isOpenAccess?: boolean | null;
  oaUrl?: string | null; // copia legal de acceso abierto
  landingUrl?: string | null;
  /** Tipos de publicación tal como los da PubMed / Europe PMC («Meta-Analysis», «Randomized Controlled Trial»…) */
  pubTypes?: string[];
  /** Retractación, corrección o aviso de preocupación (Retraction Watch vía Crossref, o PubMed) */
  retraction?: RetractionInfo | null;
  source: SourceName; // de dónde vino esta versión de los datos
  fetchedAt: string; // ISO 8601
}

export type RetractionStatus = "retracted" | "withdrawn" | "concern" | "corrected";

export interface RetractionInfo {
  status: RetractionStatus;
  /** DOI del aviso de retractación o corrección */
  noticeDoi?: string | null;
  /** Fecha del aviso (AAAA-MM-DD) */
  date?: string | null;
  /** crossref = Crossref con los datos de Retraction Watch */
  source: "crossref" | "pubmed";
}

/** Gravedad para decidir qué aviso mostrar cuando hay varios */
export const RETRACTION_RANK: Record<RetractionStatus, number> = { retracted: 4, withdrawn: 3, concern: 2, corrected: 1 };

export const RETRACTION_LABEL: Record<RetractionStatus, string> = {
  retracted: "Artículo retractado",
  withdrawn: "Artículo retirado",
  concern: "Aviso de preocupación editorial",
  corrected: "Tiene una corrección publicada",
};

export function worseRetraction(a: RetractionInfo | null | undefined, b: RetractionInfo | null | undefined): RetractionInfo | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return RETRACTION_RANK[b.status] > RETRACTION_RANK[a.status] ? b : a;
}

export type WorkIdKind = "doi" | "pmid" | "openalex" | "arxiv" | "titlehash";

export interface WorkKey {
  kind: WorkIdKind;
  value: string;
}

/**
 * Claves con las que se reconoce un artículo, de la más fiable a la menos.
 * La última (titlehash) solo se usa cuando no hay ningún identificador.
 */
export function workKeys(w: Pick<Work, "doi" | "pmid" | "openalexId" | "arxivId" | "title" | "year" | "authors">): WorkKey[] {
  const keys: WorkKey[] = [];
  const doi = normalizeDoi(w.doi);
  if (doi) keys.push({ kind: "doi", value: doi });
  const pmid = normalizePmid(w.pmid);
  if (pmid) keys.push({ kind: "pmid", value: pmid });
  const oa = normalizeOpenAlexId(w.openalexId);
  if (oa) keys.push({ kind: "openalex", value: oa });
  const ax = normalizeArxivId(w.arxivId);
  if (ax) keys.push({ kind: "arxiv", value: ax });
  if (keys.length === 0) keys.push({ kind: "titlehash", value: titleKey(w) });
  return keys;
}

/** Clave débil: título normalizado + año + apellido del primer autor. */
export function titleKey(w: Pick<Work, "title" | "year" | "authors">): string {
  const first = w.authors[0]?.name ?? "";
  const surname = normalizeTitle(first.includes(",") ? first.split(",")[0] ?? "" : first.split(" ").slice(-1)[0] ?? "");
  return `${normalizeTitle(w.title)}|${w.year ?? ""}|${surname}`;
}

/** Normaliza los identificadores de un Work antes de guardarlo. */
export function normalizeWork(w: Work): Work {
  return {
    ...w,
    title: w.title.trim(),
    doi: normalizeDoi(w.doi),
    pmid: normalizePmid(w.pmid),
    openalexId: normalizeOpenAlexId(w.openalexId),
    arxivId: normalizeArxivId(w.arxivId),
    // Algunas fuentes devuelven null dentro de la lista (verificado en Europe PMC)
    keywords: [...new Set((w.keywords ?? []).filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean))],
  };
}

/**
 * Combina dos versiones del mismo artículo: conserva lo que ya había
 * y completa los campos vacíos con la versión nueva. Las citas se actualizan
 * al valor más reciente porque cambian con el tiempo.
 */
export function mergeWork(existing: Work, incoming: Work): Work {
  const pick = <K extends keyof Work>(k: K): Work[K] => {
    const a = existing[k];
    const empty = a === null || a === undefined || a === "" || (Array.isArray(a) && a.length === 0);
    return empty ? incoming[k] : a;
  };
  return normalizeWork({
    ...existing,
    title: pick("title"),
    authors: pick("authors"),
    year: pick("year"),
    venue: pick("venue"),
    volume: pick("volume"),
    issue: pick("issue"),
    pages: pick("pages"),
    doi: pick("doi"),
    pmid: pick("pmid"),
    openalexId: pick("openalexId"),
    arxivId: pick("arxivId"),
    abstract: pick("abstract"),
    keywords: [...new Set([...(existing.keywords ?? []), ...(incoming.keywords ?? [])])],
    type: pick("type"),
    language: pick("language"),
    citedByCount: incoming.citedByCount ?? existing.citedByCount ?? null,
    isOpenAccess: incoming.isOpenAccess ?? existing.isOpenAccess ?? null,
    oaUrl: pick("oaUrl"),
    landingUrl: pick("landingUrl"),
    pubTypes: [...new Set([...(existing.pubTypes ?? []), ...(incoming.pubTypes ?? [])])],
    retraction: worseRetraction(existing.retraction, incoming.retraction),
    fetchedAt: incoming.fetchedAt > existing.fetchedAt ? incoming.fetchedAt : existing.fetchedAt,
  });
}
